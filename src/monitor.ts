import {Db, errorMessage, type Row} from './db.js';
import {ACTIVE_QUERIES, MARKER, NEXT_SINCE, OVERVIEW, PROCESSES, SERVER_INFO, recentQueries, sessionDetail} from './queries.js';

export interface ServerInfo {
	name: string;
	productVersion: string;
	productLevel: string;
	edition: string;
	cpuCount: number;
	memoryKb: number;
	startedAt: number; // local epoch ms
}

export interface ProcessRow {
	key: string;
	sessionId: number;
	userProcess: boolean;
	login: string;
	database: string;
	taskState: string;
	command: string;
	application: string;
	waitTimeMs: number | null;
	waitType: string;
	waitResource: string;
	blockedBy: number | null;
	headBlocker: boolean;
	memoryKb: number;
	host: string;
	workloadGroup: string;
	cpuMs: number;
	physicalIo: number;
	logicalReads: number;
	openTran: number;
	netAddress: string;
	loginTime: string;
	lastRequestStart: string;
	sessionStatus: string;
	requestId: number | null;
	execContextId: number | null;
	/** Number of tasks folded into this row (1 unless grouped by session). */
	tasks: number;
}

export interface ActiveQueryRow {
	key: string;
	sessionId: number;
	requestId: number;
	startTime: string;
	database: string;
	status: string;
	command: string;
	cpuMs: number;
	cpuMsPerSec: number | null;
	elapsedMs: number;
	physicalReads: number;
	writes: number;
	logicalReads: number;
	rowCount: number;
	waitType: string;
	waitTimeMs: number;
	blockedBy: number | null;
	dop: number | null;
	queryCost: number | null;
	requestedKb: number | null;
	grantedKb: number | null;
	usedKb: number | null;
	maxUsedKb: number | null;
	requiredKb: number | null;
	idealKb: number | null;
	login: string;
	host: string;
	application: string;
	queryHash: string;
	text: string;
}

export interface RecentQueryRow {
	key: string;
	text: string;
	database: string;
	executions: number;
	execPerMin: number;
	cpuMsPerSec: number;
	physicalReadsPerSec: number;
	logicalWritesPerSec: number;
	logicalReadsPerSec: number;
	avgDurationMs: number;
	avgCpuMs: number;
	planCount: number;
}

export interface Series {
	cpu: number[];
	waiting: number[];
	io: number[];
	batch: number[];
}

export interface SessionDetail {
	currentStatement: string | null;
	lastBatch: string | null;
	inputBuffer: string | null;
}

export interface MonitorState {
	server: ServerInfo | null;
	series: Series;
	processes: ProcessRow[];
	active: ActiveQueryRow[];
	recent: RecentQueryRow[];
	/** Seconds of history the recent-query rates currently cover. */
	recentWindowSec: number;
	recentReady: boolean;
	lastUpdate: number | null;
	fastQueryMs: number | null;
	error: string | null;
	recentError: string | null;
	paused: boolean;
	intervalMs: number;
}

export interface MonitorOptions {
	intervalMs: number;
	recentIntervalMs: number;
	recentWindowSec: number;
	historySize?: number;
}

interface Totals {
	executions: number;
	workerUs: number;
	physicalReads: number;
	logicalWrites: number;
	logicalReads: number;
	elapsedUs: number;
}

const TOTAL_FIELDS: Array<keyof Totals> = ['executions', 'workerUs', 'physicalReads', 'logicalWrites', 'logicalReads', 'elapsedUs'];

interface Counters {
	msTicks: number;
	cpuCount: number;
	cpuMs: number;
	ioBytes: number;
	batchRequests: number;
}

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export class Monitor {
	state: MonitorState;
	private readonly listeners = new Set<() => void>();
	private readonly historySize: number;

	private fastTimer: NodeJS.Timeout | null = null;
	private recentTimer: NodeJS.Timeout | null = null;
	private fastRunning = false;
	private recentRunning = false;
	private stopped = false;

	private prevCounters: Counters | null = null;
	private prevActiveCpu = new Map<string, {cpuMs: number; at: number}>();

	private recentSince: string | null = null;
	private recentStartedAt = 0;
	private recentTotals = new Map<string, Totals>();
	private recentInfo = new Map<string, {text: string; database: string; planCount: number}>();
	private recentSamples: Array<{at: number; deltas: Map<string, Totals>}> = [];

	constructor(
		private readonly db: Db,
		private readonly slowDb: Db,
		private readonly options: MonitorOptions,
	) {
		this.historySize = options.historySize ?? 1000;
		this.state = {
			server: null,
			series: {cpu: [], waiting: [], io: [], batch: []},
			processes: [],
			active: [],
			recent: [],
			recentWindowSec: 0,
			recentReady: false,
			lastUpdate: null,
			fastQueryMs: null,
			error: null,
			recentError: null,
			paused: false,
			intervalMs: options.intervalMs,
		};
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	};

	getState = () => this.state;

	private update(patch: Partial<MonitorState>) {
		this.state = {...this.state, ...patch};
		for (const l of this.listeners) l();
	}

	async start() {
		void this.loadServerInfo();
		void this.tickFast();
		void this.tickRecent();
	}

	async stop() {
		this.stopped = true;
		if (this.fastTimer) clearTimeout(this.fastTimer);
		if (this.recentTimer) clearTimeout(this.recentTimer);
		await Promise.all([this.db.close(), this.slowDb.close()]);
	}

	setPaused(paused: boolean) {
		this.update({paused});
		if (!paused) this.refreshNow();
	}

	setInterval(intervalMs: number) {
		this.update({intervalMs});
		this.scheduleFast(intervalMs);
	}

	refreshNow() {
		if (this.fastTimer) clearTimeout(this.fastTimer);
		void this.tickFast();
	}

	async fetchSessionDetail(sessionId: number): Promise<SessionDetail> {
		let row: Row | undefined;
		try {
			[row] = await this.db.query(sessionDetail(sessionId, true));
		} catch {
			// sys.dm_exec_input_buffer needs SQL Server 2014 SP2 / 2016 SP1 or later
			[row] = await this.db.query(sessionDetail(sessionId, false));
		}
		return {
			currentStatement: row?.current_statement ?? null,
			lastBatch: row?.last_batch ?? null,
			inputBuffer: row?.input_buffer ?? null,
		};
	}

	private async loadServerInfo() {
		try {
			const [r] = await this.slowDb.query(SERVER_INFO);
			this.update({
				server: {
					name: str(r.server_name),
					productVersion: str(r.product_version),
					productLevel: str(r.product_level),
					edition: str(r.edition),
					cpuCount: num(r.cpu_count),
					memoryKb: num(r.physical_memory_kb),
					startedAt: Date.now() - num(r.uptime_s) * 1000,
				},
			});
		} catch (err) {
			this.update({error: errorMessage(err)});
		}
	}

	private scheduleFast(delayMs: number) {
		if (this.fastTimer) clearTimeout(this.fastTimer);
		if (this.stopped || this.state.paused) return;
		this.fastTimer = setTimeout(() => void this.tickFast(), Math.max(50, delayMs));
	}

	private async tickFast() {
		if (this.fastRunning || this.stopped) return;
		this.fastRunning = true;
		const started = Date.now();
		try {
			const overview = await this.db.query(OVERVIEW);
			const processes = await this.db.query(PROCESSES);
			const active = await this.db.query(ACTIVE_QUERIES);
			const now = Date.now();
			const ours = (r: Row) => r.session_id === this.db.spid || r.session_id === this.slowDb.spid;
			this.update({
				series: this.nextSeries(overview[0]),
				processes: processes.filter(r => !ours(r)).map(toProcessRow),
				active: this.toActiveRows(active.filter(r => !ours(r)), now),
				lastUpdate: now,
				fastQueryMs: now - started,
				error: null,
			});
		} catch (err) {
			this.update({error: errorMessage(err)});
		} finally {
			this.fastRunning = false;
			this.scheduleFast(this.state.intervalMs - (Date.now() - started));
		}
	}

	private nextSeries(r: Row): Series {
		const cur: Counters = {
			msTicks: num(r.ms_ticks),
			cpuCount: num(r.cpu_count) || 1,
			cpuMs: num(r.cpu_ms),
			ioBytes: num(r.io_bytes),
			batchRequests: num(r.batch_requests),
		};
		const prev = this.prevCounters;
		this.prevCounters = cur;
		const {series} = this.state;
		const dtMs = prev ? cur.msTicks - prev.msTicks : 0;
		if (!prev || dtMs <= 0) return series;

		const push = (arr: number[], v: number) => {
			const next = arr.length >= this.historySize ? arr.slice(arr.length - this.historySize + 1) : arr.slice();
			next.push(Number.isFinite(v) ? Math.max(0, v) : 0);
			return next;
		};
		const cpuPct = Math.min(100, ((cur.cpuMs - prev.cpuMs) / (dtMs * cur.cpuCount)) * 100);
		return {
			cpu: push(series.cpu, cpuPct),
			waiting: push(series.waiting, num(r.waiting_tasks)),
			io: push(series.io, (cur.ioBytes - prev.ioBytes) / 1048576 / (dtMs / 1000)),
			batch: push(series.batch, (cur.batchRequests - prev.batchRequests) / (dtMs / 1000)),
		};
	}

	private toActiveRows(rows: Row[], now: number): ActiveQueryRow[] {
		const seen = new Map<string, {cpuMs: number; at: number}>();
		const result = rows.map((r): ActiveQueryRow => {
			const key = `${r.session_id}:${r.request_id}:${r.start_time}`;
			const cpuMs = num(r.cpu_time);
			const prev = this.prevActiveCpu.get(key);
			seen.set(key, {cpuMs, at: now});
			return {
				key,
				sessionId: num(r.session_id),
				requestId: num(r.request_id),
				startTime: str(r.start_time),
				database: str(r.database_name),
				status: str(r.status),
				command: str(r.command),
				cpuMs,
				cpuMsPerSec: prev && now > prev.at ? Math.max(0, (cpuMs - prev.cpuMs) / ((now - prev.at) / 1000)) : null,
				elapsedMs: num(r.total_elapsed_time),
				physicalReads: num(r.physical_reads),
				writes: num(r.writes),
				logicalReads: num(r.logical_reads),
				rowCount: num(r.row_count),
				waitType: str(r.wait_type),
				waitTimeMs: num(r.wait_time),
				blockedBy: numOrNull(r.blocked_by),
				dop: numOrNull(r.dop),
				queryCost: numOrNull(r.query_cost),
				requestedKb: numOrNull(r.requested_memory_kb),
				grantedKb: numOrNull(r.granted_memory_kb),
				usedKb: numOrNull(r.used_memory_kb),
				maxUsedKb: numOrNull(r.max_used_memory_kb),
				requiredKb: numOrNull(r.required_memory_kb),
				idealKb: numOrNull(r.ideal_memory_kb),
				login: str(r.login_name),
				host: str(r.host_name),
				application: str(r.program_name),
				queryHash: str(r.query_hash),
				text: str(r.statement_text),
			};
		});
		this.prevActiveCpu = seen;
		return result;
	}

	private async tickRecent() {
		if (this.recentRunning || this.stopped) return;
		this.recentRunning = true;
		try {
			if (!this.state.paused) {
				const [{next_since}] = await this.slowDb.query(NEXT_SINCE);
				const rows = await this.slowDb.query(recentQueries(this.recentSince));
				this.absorbRecent(rows, this.recentSince === null);
				this.recentSince = next_since;
			}
		} catch (err) {
			this.update({recentError: errorMessage(err)});
		} finally {
			this.recentRunning = false;
			// Take the first delta soon after the baseline so the panel fills quickly.
			const delay = this.state.recentReady ? this.options.recentIntervalMs : Math.min(3000, this.options.recentIntervalMs);
			if (!this.stopped) this.recentTimer = setTimeout(() => void this.tickRecent(), delay);
		}
	}

	private absorbRecent(rows: Row[], isBaseline: boolean) {
		const now = Date.now();
		const deltas = new Map<string, Totals>();
		for (const r of rows) {
			const key = str(r.query_key);
			const cur: Totals = {
				executions: num(r.executions),
				workerUs: num(r.worker_us),
				physicalReads: num(r.physical_reads),
				logicalWrites: num(r.logical_writes),
				logicalReads: num(r.logical_reads),
				elapsedUs: num(r.elapsed_us),
			};
			const prev = this.recentTotals.get(key);
			this.recentTotals.set(key, cur);
			if (isBaseline) continue;

			const text = str(r.statement_text);
			if (text.includes(MARKER)) continue;
			this.recentInfo.set(key, {text, database: str(r.database_name), planCount: num(r.plan_count)});
			// Unseen key => all of its plans were compiled after the baseline, so its totals are all new.
			if (!prev) {
				if (cur.executions > 0) deltas.set(key, cur);
				continue;
			}
			// A shrinking execution count means plans were evicted; we can't attribute this interval.
			if (cur.executions <= prev.executions) continue;
			const d = {} as Totals;
			for (const f of TOTAL_FIELDS) d[f] = Math.max(0, cur[f] - prev[f]);
			deltas.set(key, d);
		}

		if (isBaseline) {
			this.recentStartedAt = now;
			this.update({recentReady: false, recentError: null});
			return;
		}

		const windowMs = this.options.recentWindowSec * 1000;
		this.recentSamples.push({at: now, deltas});
		this.recentSamples = this.recentSamples.filter(s => s.at > now - windowMs);
		const windowSec = Math.max(1, Math.min(windowMs, now - this.recentStartedAt) / 1000);

		const sums = new Map<string, Totals>();
		for (const {deltas} of this.recentSamples) {
			for (const [key, d] of deltas) {
				const s = sums.get(key);
				if (!s) sums.set(key, {...d});
				else for (const f of TOTAL_FIELDS) s[f] += d[f];
			}
		}

		const recent: RecentQueryRow[] = [];
		for (const [key, s] of sums) {
			const info = this.recentInfo.get(key);
			recent.push({
				key,
				text: info?.text ?? '',
				database: info?.database ?? '',
				executions: s.executions,
				execPerMin: (s.executions / windowSec) * 60,
				cpuMsPerSec: s.workerUs / 1000 / windowSec,
				physicalReadsPerSec: s.physicalReads / windowSec,
				logicalWritesPerSec: s.logicalWrites / windowSec,
				logicalReadsPerSec: s.logicalReads / windowSec,
				avgDurationMs: s.executions ? s.elapsedUs / 1000 / s.executions : 0,
				avgCpuMs: s.executions ? s.workerUs / 1000 / s.executions : 0,
				planCount: info?.planCount ?? 0,
			});
		}
		this.update({recent, recentWindowSec: windowSec, recentReady: true, recentError: null});
	}
}

function toProcessRow(r: Row, i: number): ProcessRow {
	return {
		key: `${r.session_id}:${r.request_id ?? ''}:${r.exec_context_id ?? ''}:${i}`,
		sessionId: num(r.session_id),
		userProcess: r.is_user_process === 1,
		login: str(r.login_name),
		database: str(r.database_name),
		taskState: str(r.task_state),
		command: str(r.command),
		application: str(r.program_name),
		waitTimeMs: numOrNull(r.wait_duration_ms),
		waitType: str(r.wait_type),
		waitResource: str(r.wait_resource),
		blockedBy: numOrNull(r.blocked_by),
		headBlocker: Boolean(r.head_blocker),
		memoryKb: num(r.memory_kb),
		host: str(r.host_name),
		workloadGroup: str(r.workload_group),
		cpuMs: num(r.cpu_time),
		physicalIo: num(r.physical_io),
		logicalReads: num(r.logical_reads),
		openTran: num(r.open_tran),
		netAddress: str(r.client_net_address),
		loginTime: str(r.login_time),
		lastRequestStart: str(r.last_request_start),
		sessionStatus: str(r.session_status),
		requestId: numOrNull(r.request_id),
		execContextId: numOrNull(r.exec_context_id),
		tasks: 1,
	};
}

const TASK_STATE_RANK: Record<string, number> = {RUNNING: 5, RUNNABLE: 4, SUSPENDED: 3, SPINLOOP: 2, PENDING: 1};

/**
 * Folds the per-task rows SSMS shows (one per parallel worker) into one row per session,
 * keeping the most interesting task's state/wait and counting the tasks.
 */
export function groupBySession(rows: ProcessRow[]): ProcessRow[] {
	const bySession = new Map<number, ProcessRow>();
	for (const task of rows) {
		// Parallel workers waiting on each other report their own session as the blocker.
		const row = task.blockedBy === task.sessionId ? {...task, blockedBy: null} : task;
		const cur = bySession.get(row.sessionId);
		if (!cur) {
			bySession.set(row.sessionId, {...row, key: String(row.sessionId), tasks: row.taskState ? 1 : 0});
			continue;
		}
		if (row.taskState) cur.tasks++;
		const better =
			(TASK_STATE_RANK[row.taskState] ?? 0) > (TASK_STATE_RANK[cur.taskState] ?? 0) ||
			(row.blockedBy !== null && cur.blockedBy === null) ||
			(row.taskState === cur.taskState && (row.waitTimeMs ?? 0) > (cur.waitTimeMs ?? 0));
		if (better) {
			cur.taskState = row.taskState;
			cur.waitTimeMs = row.waitTimeMs;
			cur.waitType = row.waitType;
			cur.waitResource = row.waitResource;
			cur.blockedBy = row.blockedBy ?? cur.blockedBy;
		}
		cur.headBlocker ||= row.headBlocker;
	}
	return [...bySession.values()];
}
