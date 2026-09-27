import {describe, expect, it} from 'vitest';
import {processRow} from '../test/fixtures.js';
import {groupBySession} from './group.js';

describe('groupBySession', () => {
	it('keys rows by session and counts tasks (idle sessions have none)', () => {
		const grouped = groupBySession([processRow({sessionId: 51, taskState: ''}), processRow({sessionId: 52})]);
		expect(grouped.map(r => [r.key, r.tasks])).toEqual([
			['51', 0],
			['52', 1],
		]);
	});

	it('folds parallel tasks into one row, keeping the busiest state', () => {
		const [row] = groupBySession([
			processRow({taskState: 'SUSPENDED', waitType: 'CXPACKET', waitTimeMs: 80}),
			processRow({taskState: 'RUNNING'}),
			processRow({taskState: 'SUSPENDED', waitType: 'CXPACKET', waitTimeMs: 50}),
		]);
		expect(row).toMatchObject({tasks: 3, taskState: 'RUNNING', waitType: '', waitTimeMs: null});
	});

	it('prefers a blocked task so blocking is never hidden', () => {
		const [row] = groupBySession([
			processRow({taskState: 'RUNNING'}),
			processRow({taskState: 'SUSPENDED', waitType: 'LCK_M_S', waitTimeMs: 900, blockedBy: 99}),
		]);
		expect(row).toMatchObject({taskState: 'SUSPENDED', waitType: 'LCK_M_S', blockedBy: 99});
	});

	it('ignores parallel workers that report their own session as the blocker', () => {
		const [row] = groupBySession([
			processRow({sessionId: 10, taskState: 'RUNNING'}),
			processRow({sessionId: 10, taskState: 'SUSPENDED', waitType: 'CXCONSUMER', blockedBy: 10}),
		]);
		expect(row).toMatchObject({taskState: 'RUNNING', blockedBy: null});
	});

	it('keeps the longest wait among tasks in the same state', () => {
		const [row] = groupBySession([
			processRow({taskState: 'SUSPENDED', waitType: 'A', waitTimeMs: 10}),
			processRow({taskState: 'SUSPENDED', waitType: 'B', waitTimeMs: 300}),
			processRow({taskState: 'SUSPENDED', waitType: 'C', waitTimeMs: 20}),
		]);
		expect(row).toMatchObject({waitType: 'B', waitTimeMs: 300});
	});

	it('marks the session as a head blocker if any task is', () => {
		const [row] = groupBySession([processRow(), processRow({headBlocker: true}), processRow()]);
		expect(row!.headBlocker).toBe(true);
	});

	it('does not mutate its input', () => {
		const rows = [processRow({taskState: 'SUSPENDED'}), processRow({taskState: 'RUNNING', blockedBy: 3})];
		const copy = structuredClone(rows);
		groupBySession(rows);
		expect(rows).toEqual(copy);
	});
});
