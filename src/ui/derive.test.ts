import {describe, expect, it} from 'vitest';
import {activeRow, monitorState, processRow, recentRow} from '../test/fixtures.js';
import {deriveTables, filterProcesses, matchesFilter} from './derive.js';
import {initialViewState, type ProcessFilters, type ViewState} from './view-state.js';

const none: ProcessFilters = {tasks: false, user: false, blocking: false, grouped: false};

describe('matchesFilter', () => {
	it('matches any field case-insensitively, including numbers', () => {
		expect(matchesFilter('ALICE', 'corp\\alice', null)).toBe(true);
		expect(matchesFilter('55', 55)).toBe(true);
		expect(matchesFilter('bob', 'alice', null)).toBe(false);
	});

	it('matches everything when empty', () => {
		expect(matchesFilter('', null)).toBe(true);
	});
});

describe('filterProcesses', () => {
	const idle = processRow({sessionId: 1, taskState: ''});
	const system = processRow({sessionId: 2, userProcess: false});
	const blocked = processRow({sessionId: 3, blockedBy: 4});
	const blocker = processRow({sessionId: 4, headBlocker: true, login: 'CORP\\bob'});
	const rows = [idle, system, blocked, blocker];
	const ids = (f: ProcessFilters, text = '') => filterProcesses(rows, f, text).map(r => r.sessionId);

	it('applies each filter independently', () => {
		expect(ids(none)).toEqual([1, 2, 3, 4]);
		expect(ids({...none, tasks: true})).toEqual([2, 3, 4]);
		expect(ids({...none, user: true})).toEqual([1, 3, 4]);
		expect(ids({...none, blocking: true})).toEqual([3, 4]);
	});

	it('also applies the text filter', () => {
		expect(ids(none, 'bob')).toEqual([4]);
	});
});

describe('deriveTables', () => {
	const view = (patch: (v: ViewState) => ViewState = v => v) => patch(initialViewState());

	it('groups parallel tasks by default and counts the unfiltered total', () => {
		const state = monitorState({
			processes: [processRow({sessionId: 60}), processRow({sessionId: 60}), processRow({sessionId: 61, taskState: ''})],
		});
		const {processes} = deriveTables(state, view());
		expect(processes.rows.map(r => [r.sessionId, r.tasks])).toEqual([[60, 2]]);
		expect(processes.total).toBe(2);
		expect(processes.columns.some(c => c.id === 'tasks')).toBe(true);
	});

	it('shows one row per task when grouping is off', () => {
		const state = monitorState({processes: [processRow({sessionId: 60}), processRow({sessionId: 60})]});
		const {processes} = deriveTables(
			state,
			view(v => ({...v, processFilters: {...v.processFilters, grouped: false}})),
		);
		expect(processes.rows).toHaveLength(2);
		expect(processes.columns.some(c => c.id === 'tasks')).toBe(false);
	});

	it('sorts by the chosen column', () => {
		const state = monitorState({
			active: [activeRow({key: 'a', sessionId: 1, cpuMs: 10}), activeRow({key: 'b', sessionId: 2, cpuMs: 99})],
			recent: [recentRow({key: 'x', cpuMsPerSec: 1}), recentRow({key: 'y', cpuMsPerSec: 5})],
		});
		const tables = deriveTables(state, view());
		expect(tables.active.rows.map(r => r.key)).toEqual(['b', 'a']);
		expect(tables.recent.rows.map(r => r.key)).toEqual(['y', 'x']);
	});

	it('applies each table’s own text filter', () => {
		const state = monitorState({
			active: [activeRow({key: 'a', text: 'SELECT orders'}), activeRow({key: 'b', text: 'UPDATE stock'})],
			recent: [recentRow({key: 'x', text: 'SELECT orders'}), recentRow({key: 'y', database: 'Stock'})],
		});
		const filtered = view(v => ({
			...v,
			tables: {
				...v.tables,
				active: {...v.tables.active, filter: 'stock'},
				recent: {...v.tables.recent, filter: 'stock'},
			},
		}));
		const tables = deriveTables(state, filtered);
		expect(tables.active.rows.map(r => r.key)).toEqual(['b']);
		expect(tables.recent.rows.map(r => r.key)).toEqual(['y']);
	});
});
