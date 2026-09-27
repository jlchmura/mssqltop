import {afterEach, describe, expect, it, vi} from 'vitest';
import type {QueryRunner} from '../db/db.js';
import type {Row} from '../db/values.js';
import {ACTIVE_QUERIES, MARKER, NEXT_SINCE, OVERVIEW, PROCESSES, SERVER_INFO} from '../sql/queries.js';
import {Monitor, type MonitorOptions} from './monitor.js';

const FAST_SPID = 90;
const SLOW_SPID = 91;

/** A QueryRunner that answers each monitoring query from overridable handlers. */
class FakeDb implements QueryRunner {
	readonly queries: string[] = [];
	readonly close = vi.fn(async () => {});
	constructor(
		readonly spid: number,
		private readonly handle: (sql: string) => Row[] | Promise<Row[]>,
	) {}
	async query(sql: string): Promise<Row[]> {
		this.queries.push(sql);
		return this.handle(sql);
	}
}

interface Scenario {
	overview?: () => Row;
	processes?: Row[];
	active?: Row[];
	recentBaseline?: Row[];
	recentUpdate?: Row[];
	detail?: (sql: string) => Row[];
	fail?: (sql: string) => Error | undefined;
}

let ticks = 0;
const defaultOverview = (): Row => {
	ticks++;
	return {
		ms_ticks: ticks * 2000,
		cpu_count: 4,
		cpu_ms: ticks * 2000,
		io_bytes: 0,
		batch_requests: ticks * 10,
		waiting_tasks: 3,
	};
};

function setup(scenario: Scenario = {}, options: Partial<MonitorOptions> = {}) {
	const handler = (sql: string): Row[] => {
		const failure = scenario.fail?.(sql);
		if (failure) throw failure;
		if (sql === SERVER_INFO)
			return [
				{
					server_name: 'DB1',
					product_version: '16.0.1.1',
					product_level: 'RTM',
					edition: 'Developer',
					cpu_count: 4,
					physical_memory_kb: 1,
					uptime_s: 1,
				},
			];
		if (sql === OVERVIEW) return [(scenario.overview ?? defaultOverview)()];
		if (sql === PROCESSES) return scenario.processes ?? [];
		if (sql === ACTIVE_QUERIES) return scenario.active ?? [];
		if (sql === NEXT_SINCE) return [{next_since: '2026-01-01 00:00:00.000'}];
		if (sql.includes('dm_exec_query_stats'))
			return sql.includes('HAVING') ? (scenario.recentUpdate ?? []) : (scenario.recentBaseline ?? []);
		if (sql.includes('current_statement')) return scenario.detail?.(sql) ?? [];
		throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
	};
	const db = new FakeDb(FAST_SPID, handler);
	const slowDb = new FakeDb(SLOW_SPID, handler);
	// Long intervals: tests drive refreshes explicitly with refreshNow().
	const monitor = new Monitor(db, slowDb, {
		intervalMs: 60_000,
		recentIntervalMs: 60_000,
		recentWindowSec: 60,
		...options,
	});
	monitors.push(monitor);
	return {monitor, db, slowDb};
}

const monitors: Monitor[] = [];
afterEach(async () => {
	await Promise.all(monitors.splice(0).map(m => m.stop()));
	ticks = 0;
});

describe('Monitor', () => {
	it('loads server info on the slow connection', async () => {
		const {monitor, slowDb} = setup();
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.server?.name).toBe('DB1'));
		expect(slowDb.queries).toContain(SERVER_INFO);
	});

	it('publishes processes and active queries, hiding both of its own sessions', async () => {
		const {monitor} = setup({
			processes: [{session_id: 55, is_user_process: 1}, {session_id: FAST_SPID}, {session_id: SLOW_SPID}],
			active: [
				{session_id: 55, request_id: 0, start_time: 't', cpu_time: 10},
				{session_id: SLOW_SPID, request_id: 0},
			],
		});
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.lastUpdate).not.toBeNull());
		expect(monitor.state.processes.map(p => p.sessionId)).toEqual([55]);
		expect(monitor.state.active.map(a => a.sessionId)).toEqual([55]);
		expect(monitor.state.error).toBeNull();
	});

	it('adds a chart sample from the second refresh on', async () => {
		const {monitor} = setup();
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.lastUpdate).not.toBeNull());
		expect(monitor.state.series.cpu).toEqual([]);

		monitor.refreshNow();
		// 2000 CPU-ms over 2000ms on 4 CPUs = 25%; 10 batches in 2s = 5/s.
		await vi.waitFor(() => expect(monitor.state.series.cpu).toEqual([25]));
		expect(monitor.state.series).toMatchObject({waiting: [3], io: [0], batch: [5]});
	});

	it('computes each active request’s CPU rate between refreshes', async () => {
		let cpu = 1000;
		const {monitor} = setup({
			active: [
				{
					session_id: 55,
					request_id: 0,
					start_time: 't',
					get cpu_time() {
						return cpu;
					},
				},
			],
		});
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.active[0]?.cpuMsPerSec).toBeNull());
		cpu = 3000;
		monitor.refreshNow();
		await vi.waitFor(() => expect(monitor.state.active[0]?.cpuMsPerSec).toBeGreaterThan(0));
	});

	it('reports errors with a clean message and clears them once queries succeed', async () => {
		let broken = true;
		const {monitor} = setup({
			fail: sql =>
				broken && sql === OVERVIEW
					? Object.assign(new Error('[odbc]'), {
							odbcErrors: [
								{state: 'HYT00', message: '[Microsoft][ODBC Driver 18 for SQL Server]Login timeout expired'},
							],
						})
					: undefined,
		});
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.error).toBe('Login timeout expired'));
		broken = false;
		monitor.refreshNow();
		await vi.waitFor(() => expect(monitor.state.error).toBeNull());
	});

	it('takes a plan-cache baseline, then publishes recent queries, hiding its own', async () => {
		const {monitor} = setup(
			{
				recentBaseline: [{query_key: 'A', executions: 1}],
				recentUpdate: [
					{query_key: 'A', executions: 3, statement_text: 'SELECT a'},
					{query_key: 'SELF', executions: 9, statement_text: `SELECT ${MARKER} 1`},
				],
			},
			{recentIntervalMs: 10},
		);
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.recentReady).toBe(true));
		expect(monitor.state.recent.map(r => [r.key, r.executions])).toEqual([['A', 2]]);
	});

	it('fetches session detail, falling back when sys.dm_exec_input_buffer is unavailable', async () => {
		const {monitor, db} = setup({
			fail: sql => (sql.includes('dm_exec_input_buffer') ? new Error('Invalid object name') : undefined),
			detail: () => [{current_statement: 'SELECT 1', last_batch: 'EXEC p'}],
		});
		await expect(monitor.fetchSessionDetail(55)).resolves.toEqual({
			currentStatement: 'SELECT 1',
			lastBatch: 'EXEC p',
			inputBuffer: null,
		});
		expect(db.queries.filter(q => q.includes('current_statement'))).toHaveLength(2);
	});

	it('pauses and resumes, refreshing immediately on resume', async () => {
		const {monitor, db} = setup();
		monitor.start();
		await vi.waitFor(() => expect(monitor.state.lastUpdate).not.toBeNull());
		monitor.setPaused(true);
		expect(monitor.state.paused).toBe(true);

		const before = db.queries.filter(q => q === OVERVIEW).length;
		monitor.setPaused(false);
		await vi.waitFor(() => expect(db.queries.filter(q => q === OVERVIEW).length).toBe(before + 1));
	});

	it('changes the refresh interval', () => {
		const {monitor} = setup();
		monitor.setInterval(5000);
		expect(monitor.state.intervalMs).toBe(5000);
	});

	it('notifies subscribers with a new state object until they unsubscribe', async () => {
		const {monitor} = setup();
		const listener = vi.fn();
		const unsubscribe = monitor.subscribe(listener);
		const initial = monitor.getState();
		monitor.setInterval(5000);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(monitor.getState()).not.toBe(initial);

		unsubscribe();
		monitor.setInterval(10_000);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('closes both connections on stop', async () => {
		const {monitor, db, slowDb} = setup();
		await monitor.stop();
		expect(db.close).toHaveBeenCalled();
		expect(slowDb.close).toHaveBeenCalled();
	});
});
