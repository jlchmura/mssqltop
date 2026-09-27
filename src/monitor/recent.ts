/**
 * Recent Expensive Queries: turns successive dm_exec_query_stats snapshots (see recentQueries in
 * src/sql/queries.ts) into per-query rates over a rolling window.
 *
 * The first scan is a baseline of every query's cumulative totals. Each later scan returns only
 * queries that finished an execution since the previous scan; diffing those against the last-seen
 * totals gives what happened in between. Deltas are kept per scan interval and summed over the window.
 */
import type {Row} from '../db/values.js';
import {num, str} from './rows.js';
import type {RecentQueryRow} from './types.js';

interface Totals {
	executions: number;
	workerUs: number;
	physicalReads: number;
	logicalWrites: number;
	logicalReads: number;
	elapsedUs: number;
}

const FIELDS: ReadonlyArray<keyof Totals> = [
	'executions',
	'workerUs',
	'physicalReads',
	'logicalWrites',
	'logicalReads',
	'elapsedUs',
];

/** Deltas observed by one scan, covering the time since the previous scan. */
interface Interval {
	from: number;
	to: number;
	deltas: Map<string, Totals>;
}

export interface RecentWindow {
	rows: RecentQueryRow[];
	/** Seconds the rates are averaged over (grows to the configured window after startup). */
	windowSec: number;
}

export interface RecentTrackerOptions {
	windowSec: number;
	/** Statements to leave out, e.g. the monitor's own queries. */
	ignore?: (statementText: string) => boolean;
}

export class RecentQueryTracker {
	private readonly totals = new Map<string, Totals>();
	private readonly info = new Map<string, {text: string; database: string; planCount: number}>();
	private intervals: Interval[] = [];
	private lastScanAt: number | null = null;

	constructor(private readonly options: RecentTrackerOptions) {}

	get hasBaseline(): boolean {
		return this.lastScanAt !== null;
	}

	/** Records every query's cumulative totals; later scans are measured against these. */
	baseline(rows: readonly Row[], now: number): void {
		for (const r of rows) this.totals.set(str(r.query_key), readTotals(r));
		this.lastScanAt = now;
	}

	/** Folds in a scan of recently finished queries and returns the rolling window. */
	update(rows: readonly Row[], now: number): RecentWindow {
		if (this.lastScanAt === null) throw new Error('RecentQueryTracker.update() called before baseline()');
		const deltas = new Map<string, Totals>();
		for (const r of rows) {
			const key = str(r.query_key);
			const cur = readTotals(r);
			const prev = this.totals.get(key);
			this.totals.set(key, cur);

			const text = str(r.statement_text);
			if (this.options.ignore?.(text)) continue;
			this.info.set(key, {text, database: str(r.database_name), planCount: num(r.plan_count)});

			const delta = diff(prev, cur);
			if (delta) deltas.set(key, delta);
		}

		this.intervals.push({from: this.lastScanAt, to: now, deltas});
		this.lastScanAt = now;
		// Keep intervals that start inside the window, but always the latest one.
		const windowStart = now - this.options.windowSec * 1000;
		while (this.intervals.length > 1 && this.intervals[0]!.from < windowStart) this.intervals.shift();
		const windowSec = Math.max(1, (now - this.intervals[0]!.from) / 1000);

		const sums = new Map<string, Totals>();
		for (const {deltas} of this.intervals) {
			for (const [key, d] of deltas) {
				const sum = sums.get(key);
				if (sum) for (const f of FIELDS) sum[f] += d[f];
				else sums.set(key, {...d});
			}
		}
		for (const key of this.info.keys()) if (!sums.has(key)) this.info.delete(key);

		const result: RecentQueryRow[] = [];
		for (const [key, s] of sums) {
			const info = this.info.get(key);
			result.push({
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
		return {rows: result, windowSec};
	}
}

function readTotals(r: Row): Totals {
	return {
		executions: num(r.executions),
		workerUs: num(r.worker_us),
		physicalReads: num(r.physical_reads),
		logicalWrites: num(r.logical_writes),
		logicalReads: num(r.logical_reads),
		elapsedUs: num(r.elapsed_us),
	};
}

/** What happened between two snapshots of one query, or null if nothing attributable did. */
function diff(prev: Totals | undefined, cur: Totals): Totals | null {
	// Unseen since the baseline: all of its plans were compiled after it, so everything is new.
	if (!prev) return cur.executions > 0 ? cur : null;
	// A shrinking execution count means plans were evicted; this interval can't be attributed.
	if (cur.executions <= prev.executions) return null;
	const d = {} as Totals;
	for (const f of FIELDS) d[f] = Math.max(0, cur[f] - prev[f]);
	return d;
}
