import type {QueryRunner} from '../db/db.js';
import {errorMessage, type Row} from '../db/values.js';
import {
	ACTIVE_QUERIES,
	MARKER,
	NEXT_SINCE,
	OVERVIEW,
	PROCESSES,
	SERVER_INFO,
	activePlan,
	livePlan,
	recentPlan,
	recentQueries,
	sessionDetail,
} from '../sql/queries.js';
import {RecentQueryTracker} from './recent.js';
import {RateTracker, activeKey, num, str, toActiveRow, toProcessRow, toServerInfo} from './rows.js';
import {appendSample, emptySeries, readCounters, sampleBetween, type Counters} from './series.js';
import type {FetchedPlan, MonitorState, PlanTarget, SessionDetail} from './types.js';

export interface MonitorOptions {
	/** Refresh interval for the charts, processes and active queries. */
	intervalMs: number;
	/** How often to scan the plan cache for Recent Expensive Queries (a heavier query). */
	recentIntervalMs: number;
	/** Rolling window the recent-query rates cover. */
	recentWindowSec: number;
	/** Chart samples to keep. */
	historySize?: number;
	/** Injectable clock for tests. */
	now?: () => number;
}

/** Delay before the first recent-query delta, so the panel fills soon after startup. */
const FIRST_RECENT_DELAY_MS = 3000;
const MIN_TICK_DELAY_MS = 50;

/**
 * Polls SQL Server and publishes a {@link MonitorState} snapshot to subscribers
 * (shaped for React's useSyncExternalStore).
 *
 * Two connections are used so the slow plan-cache scan never delays the fast refresh:
 *   - `db`: overview counters, processes and active requests every `intervalMs`, plus on-demand details
 *   - `slowDb`: server info once, then Recent Expensive Queries every `recentIntervalMs`
 */
export class Monitor {
	state: MonitorState;
	private readonly listeners = new Set<() => void>();
	private readonly historySize: number;
	private readonly now: () => number;

	private fastTimer: ReturnType<typeof setTimeout> | null = null;
	private recentTimer: ReturnType<typeof setTimeout> | null = null;
	private fastRunning = false;
	private recentRunning = false;
	private stopped = false;

	private prevCounters: Counters | null = null;
	private readonly activeCpu = new RateTracker();
	private readonly recent: RecentQueryTracker;
	private recentSince: string | null = null;

	constructor(
		private readonly db: QueryRunner,
		private readonly slowDb: QueryRunner,
		private readonly options: MonitorOptions,
	) {
		this.historySize = options.historySize ?? 1000;
		this.now = options.now ?? Date.now;
		this.recent = new RecentQueryTracker({
			windowSec: options.recentWindowSec,
			ignore: text => text.includes(MARKER),
		});
		this.state = {
			server: null,
			series: emptySeries(),
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

	// ---- subscription (useSyncExternalStore) -------------------------------------------------------

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	};

	getState = (): MonitorState => this.state;

	private update(patch: Partial<MonitorState>): void {
		this.state = {...this.state, ...patch};
		for (const listener of this.listeners) listener();
	}

	// ---- control -----------------------------------------------------------------------------------

	start(): void {
		void this.loadServerInfo();
		void this.tickFast();
		void this.tickRecent();
	}

	/** Stops polling and closes both connections once their in-flight queries finish. */
	async stop(): Promise<void> {
		this.stopped = true;
		if (this.fastTimer) clearTimeout(this.fastTimer);
		if (this.recentTimer) clearTimeout(this.recentTimer);
		await Promise.all([this.db.close(), this.slowDb.close()]);
	}

	setPaused(paused: boolean): void {
		this.update({paused});
		if (!paused) this.refreshNow();
	}

	setInterval(intervalMs: number): void {
		this.update({intervalMs});
		this.scheduleFast(intervalMs);
	}

	refreshNow(): void {
		if (this.fastTimer) clearTimeout(this.fastTimer);
		void this.tickFast();
	}

	async fetchSessionDetail(sessionId: number): Promise<SessionDetail> {
		let row: Row | undefined;
		try {
			[row] = await this.db.query(sessionDetail(sessionId, true));
		} catch {
			// sys.dm_exec_input_buffer needs SQL Server 2014 SP2 / 2016 SP1 or later.
			[row] = await this.db.query(sessionDetail(sessionId, false));
		}
		const text = (v: unknown) => (v == null ? null : String(v));
		return {
			currentStatement: text(row?.current_statement),
			lastBatch: text(row?.last_batch),
			inputBuffer: text(row?.input_buffer),
		};
	}

	/** The plan behind an active request (live if the server can provide it) or a recent query; null if none is cached. */
	async fetchPlan(target: PlanTarget): Promise<FetchedPlan | null> {
		const planOf = async (sql: string) => {
			const [row] = await this.db.query(sql);
			return row?.query_plan == null || row.query_plan === '' ? null : String(row.query_plan);
		};
		if (target.kind === 'recent') {
			const xml = await planOf(recentPlan(target.key));
			return xml ? {source: 'estimated', xml} : null;
		}
		try {
			const xml = await planOf(livePlan(target.sessionId, target.requestId));
			if (xml) return {source: 'live', xml};
		} catch {
			// sys.dm_exec_query_statistics_xml needs SQL Server 2016 SP1 or later; fall back to the cached plan.
		}
		const xml = await planOf(activePlan(target.sessionId, target.requestId));
		return xml ? {source: 'estimated', xml} : null;
	}

	// ---- polling -----------------------------------------------------------------------------------

	private async loadServerInfo(): Promise<void> {
		try {
			const [row] = await this.slowDb.query(SERVER_INFO);
			if (row) this.update({server: toServerInfo(row, this.now())});
		} catch (err) {
			this.update({error: errorMessage(err)});
		}
	}

	private scheduleFast(delayMs: number): void {
		if (this.fastTimer) clearTimeout(this.fastTimer);
		if (this.stopped || this.state.paused) return;
		this.fastTimer = setTimeout(() => void this.tickFast(), Math.max(MIN_TICK_DELAY_MS, delayMs));
	}

	private async tickFast(): Promise<void> {
		if (this.fastRunning || this.stopped) return;
		this.fastRunning = true;
		const started = this.now();
		try {
			const [overview] = await this.db.query(OVERVIEW);
			const processes = await this.db.query(PROCESSES);
			const active = (await this.db.query(ACTIVE_QUERIES)).filter(r => !this.isOwnSession(r));
			const now = this.now();
			const cpuRates = this.activeCpu.next(
				active.map(r => [activeKey(r), num(r.cpu_time)] as const),
				now,
			);
			this.update({
				series: overview ? this.nextSeries(overview) : this.state.series,
				processes: processes.filter(r => !this.isOwnSession(r)).map(toProcessRow),
				active: active.map(r => toActiveRow(r, cpuRates.get(activeKey(r)) ?? null)),
				lastUpdate: now,
				fastQueryMs: now - started,
				error: null,
			});
		} catch (err) {
			this.update({error: errorMessage(err)});
		} finally {
			this.fastRunning = false;
			this.scheduleFast(this.state.intervalMs - (this.now() - started));
		}
	}

	/** Our own connections are left out; the queries already exclude @@SPID, this also covers slowDb. */
	private isOwnSession(r: Row): boolean {
		return r.session_id === this.db.spid || r.session_id === this.slowDb.spid;
	}

	private nextSeries(row: Row) {
		const cur = readCounters(row);
		const prev = this.prevCounters;
		this.prevCounters = cur;
		const sample = prev && sampleBetween(prev, cur);
		return sample ? appendSample(this.state.series, sample, this.historySize) : this.state.series;
	}

	private async tickRecent(): Promise<void> {
		if (this.recentRunning || this.stopped) return;
		this.recentRunning = true;
		try {
			if (!this.state.paused) {
				const [sinceRow] = await this.slowDb.query(NEXT_SINCE);
				const rows = await this.slowDb.query(recentQueries(this.recentSince));
				const now = this.now();
				if (this.recent.hasBaseline) {
					const {rows: recent, windowSec} = this.recent.update(rows, now);
					this.update({recent, recentWindowSec: windowSec, recentReady: true, recentError: null});
				} else {
					this.recent.baseline(rows, now);
					this.update({recentError: null});
				}
				this.recentSince = str(sinceRow?.next_since) || this.recentSince;
			}
		} catch (err) {
			this.update({recentError: errorMessage(err)});
		} finally {
			this.recentRunning = false;
			const delay = this.state.recentReady
				? this.options.recentIntervalMs
				: Math.min(FIRST_RECENT_DELAY_MS, this.options.recentIntervalMs);
			if (!this.stopped) this.recentTimer = setTimeout(() => void this.tickRecent(), delay);
		}
	}
}
