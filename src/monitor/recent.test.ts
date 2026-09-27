import {describe, expect, it} from 'vitest';
import type {Row} from '../db/values.js';
import {RecentQueryTracker} from './recent.js';

const S = 1000;

/** A plan-cache row as returned by recentQueries(): cumulative totals for one query. */
const row = (key: string, executions: number, extra: Partial<Record<string, unknown>> = {}): Row => ({
	query_key: key,
	executions,
	worker_us: executions * 2000,
	physical_reads: executions,
	logical_writes: 0,
	logical_reads: executions * 100,
	elapsed_us: executions * 3000,
	plan_count: 1,
	statement_text: `SELECT ${key}`,
	database_name: 'Sales',
	...extra,
});

const tracker = (windowSec = 60, ignore?: (text: string) => boolean) =>
	new RecentQueryTracker(ignore ? {windowSec, ignore} : {windowSec});

describe('RecentQueryTracker', () => {
	it('requires a baseline first', () => {
		const t = tracker();
		expect(t.hasBaseline).toBe(false);
		expect(() => t.update([], 0)).toThrow(/baseline/);
		t.baseline([], 0);
		expect(t.hasBaseline).toBe(true);
	});

	it('reports what happened since the baseline as rates', () => {
		const t = tracker();
		t.baseline([row('A', 10)], 0);
		const {rows, windowSec} = t.update([row('A', 15)], 10 * S);

		expect(windowSec).toBe(10);
		expect(rows).toEqual([
			{
				key: 'A',
				text: 'SELECT A',
				database: 'Sales',
				executions: 5,
				execPerMin: 30, // 5 in 10s
				cpuMsPerSec: 1, // 5 × 2ms in 10s
				physicalReadsPerSec: 0.5,
				logicalWritesPerSec: 0,
				logicalReadsPerSec: 50,
				avgDurationMs: 3,
				avgCpuMs: 2,
				planCount: 1,
			},
		]);
	});

	it('counts all activity of a query first seen after the baseline', () => {
		const t = tracker();
		t.baseline([], 0);
		expect(t.update([row('NEW', 4)], 10 * S).rows[0]!.executions).toBe(4);
	});

	it('skips a query whose execution count shrank (plan evicted) and re-baselines it', () => {
		const t = tracker();
		t.baseline([row('A', 10)], 0);
		expect(t.update([row('A', 3)], 10 * S).rows).toEqual([]);
		expect(t.update([row('A', 5)], 20 * S).rows[0]!.executions).toBe(2);
	});

	it('skips queries with no new executions', () => {
		const t = tracker();
		t.baseline([row('A', 10)], 0);
		expect(t.update([row('A', 10)], 10 * S).rows).toEqual([]);
	});

	it('clamps individual counters that went backwards', () => {
		const t = tracker();
		t.baseline([row('A', 10)], 0);
		const [r] = t.update([row('A', 11, {physical_reads: 0})], 10 * S).rows;
		expect(r!.physicalReadsPerSec).toBe(0);
	});

	it('leaves out ignored statements', () => {
		const t = tracker(60, text => text.includes('mine'));
		t.baseline([], 0);
		const {rows} = t.update([row('A', 1), row('B', 1, {statement_text: '/* mine */ SELECT 1'})], 10 * S);
		expect(rows.map(r => r.key)).toEqual(['A']);
	});

	it('sums intervals inside the window and drops ones that aged out', () => {
		const t = tracker(60);
		t.baseline([row('A', 0)], 0);
		// One execution of A every 10s for 80s.
		let result;
		for (let sec = 10, n = 1; sec <= 80; sec += 10, n++) result = t.update([row('A', n)], sec * S);

		// Intervals starting before 80 - 60 = 20s are gone: 6 remain, covering exactly 60s.
		expect(result!.windowSec).toBe(60);
		expect(result!.rows[0]).toMatchObject({executions: 6, execPerMin: 6});
	});

	it('grows the window during startup and never reports less than 1s', () => {
		const t = tracker(60);
		t.baseline([row('A', 0)], 0);
		expect(t.update([row('A', 1)], 200).windowSec).toBe(1);
		expect(t.update([row('A', 2)], 25 * S).windowSec).toBe(25);
	});

	it('forgets queries once all their activity has left the window', () => {
		const t = tracker(30);
		t.baseline([row('A', 0)], 0);
		t.update([row('A', 5)], 10 * S);
		t.update([], 40 * S);
		expect(t.update([], 50 * S).rows).toEqual([]);
	});

	it('keeps the latest statement text and database', () => {
		const t = tracker();
		t.baseline([row('A', 1)], 0);
		t.update([row('A', 2, {statement_text: 'old'})], 10 * S);
		const [r] = t.update([row('A', 3, {statement_text: 'new', database_name: 'Other'})], 20 * S).rows;
		expect(r).toMatchObject({text: 'new', database: 'Other', executions: 2});
	});
});
