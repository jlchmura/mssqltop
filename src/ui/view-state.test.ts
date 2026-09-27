import {describe, expect, it} from 'vitest';
import {activeRow, processRow, recentRow} from '../test/fixtures.js';
import {activeColumns, processColumns, recentColumns} from './columns.js';
import {
	focusedTable,
	handleKey,
	initialViewState,
	selectedIndex,
	stepInterval,
	type KeyContext,
	type KeyPress,
	type ViewState,
} from './view-state.js';

const procs = [51, 52, 53, 54, 55].map(sessionId => processRow({sessionId, key: String(sessionId)}));

function context(overrides: Partial<KeyContext> = {}): KeyContext {
	return {
		tables: {
			processes: {rows: procs, columns: processColumns(true)},
			recent: {rows: [recentRow()], columns: recentColumns},
			active: {rows: [activeRow()], columns: activeColumns},
		},
		pageRows: {processes: 2, recent: 2, active: 2},
		overlayMaxOffset: 10,
		overlayPageRows: 4,
		paused: false,
		intervalMs: 2000,
		...overrides,
	};
}

/** Applies a sequence of keys (strings are typed input, objects are special keys). */
function press(state: ViewState, keys: Array<string | KeyPress>, ctx = context()) {
	let s = state;
	let effect;
	for (const k of keys)
		({state: s, effect} = typeof k === 'string' ? handleKey(s, k, {}, ctx) : handleKey(s, '', k, ctx));
	return {state: s, effect};
}

const start = initialViewState();
const selectedSession = (s: ViewState) => s.tables.processes.selectedKey;

describe('initialViewState', () => {
	it('starts on processes, filtered like SSMS users usually do', () => {
		expect(start.focus).toBe('processes');
		expect(start.processFilters).toEqual({tasks: true, user: true, blocking: false, grouped: true});
		expect(focusedTable(start)).toBe('processes');
	});
});

describe('selectedIndex', () => {
	const rows = [{key: 'a'}, {key: 'b'}, {key: 'c'}];
	const view = start.tables.processes;

	it('follows the selected key when rows move', () => {
		expect(selectedIndex(rows, {...view, selectedKey: 'c', selected: 0})).toBe(2);
	});

	it('falls back to the previous index, clamped, when the row is gone', () => {
		expect(selectedIndex(rows, {...view, selectedKey: 'zzz', selected: 1})).toBe(1);
		expect(selectedIndex(rows, {...view, selectedKey: 'zzz', selected: 9})).toBe(2);
		expect(selectedIndex([], {...view, selected: 3})).toBe(0);
	});
});

describe('stepInterval', () => {
	it.each([
		[2000, 1, 5000],
		[2000, -1, 1000],
		[1000, -1, 1000],
		[60_000, 1, 60_000],
		[7000, -1, 5000],
	] as const)('from %s by %s → %s', (from, dir, expected) => {
		expect(stepInterval(from, dir)).toBe(expected);
	});
});

describe('handleKey: selection', () => {
	it('moves down and up by row, clamped to the table', () => {
		expect(selectedSession(press(start, [{downArrow: true}, 'j']).state)).toBe('53');
		expect(selectedSession(press(start, [{downArrow: true}, {upArrow: true}, 'k']).state)).toBe('51');
	});

	it('pages and jumps to either end', () => {
		expect(selectedSession(press(start, [{pageDown: true}]).state)).toBe('53');
		expect(selectedSession(press(start, [{end: true}]).state)).toBe('55');
		expect(selectedSession(press(start, [{end: true}, {pageUp: true}]).state)).toBe('53');
		expect(selectedSession(press(start, [{end: true}, {home: true}]).state)).toBe('51');
	});

	it('does nothing on an empty table', () => {
		const empty = context({tables: {...context().tables, processes: {rows: [], columns: []}}});
		expect(press(start, [{downArrow: true}], empty).state).toBe(start);
	});
});

describe('handleKey: panels and toggles', () => {
	it('Tab switches focus between processes and the query tab', () => {
		const {state} = press(start, [{tab: true}]);
		expect(state.focus).toBe('queries');
		expect(focusedTable(state)).toBe('active');
		expect(press(state, [{tab: true}]).state.focus).toBe('processes');
	});

	it('e toggles recent/active; arrows do too, but only when queries are focused', () => {
		expect(press(start, ['e']).state.queryTab).toBe('recent');
		expect(press(start, [{rightArrow: true}]).state.queryTab).toBe('active');
		expect(press(start, [{tab: true}, {leftArrow: true}]).state.queryTab).toBe('recent');
	});

	it.each([
		['t', 'tasks'],
		['u', 'user'],
		['b', 'blocking'],
		['g', 'grouped'],
	] as const)('%s toggles the %s filter', (key, filter) => {
		expect(press(start, [key]).state.processFilters[filter]).toBe(!start.processFilters[filter]);
	});

	it('m maximizes and c hides the charts', () => {
		expect(press(start, ['m']).state.maximized).toBe(true);
		expect(press(start, ['c']).state.showCharts).toBe(false);
	});
});

describe('handleKey: sorting', () => {
	it('> moves to the next column, choosing descending for numeric ones', () => {
		const {state} = press(start, ['>']);
		expect(state.tables.processes).toMatchObject({sortId: 'user', sortDesc: false});
		expect(press(start, ['>', '>', '>']).state.tables.processes.sortId).toBe('database');
	});

	it('< wraps around to the last column', () => {
		expect(press(start, ['<']).state.tables.processes.sortId).toBe('group');
	});

	it('i inverts the current sort', () => {
		expect(press(start, ['i']).state.tables.processes.sortDesc).toBe(true);
	});

	it('sorts the focused table only', () => {
		const {state} = press(start, [{tab: true}, 'i']);
		expect(state.tables.active.sortDesc).toBe(false);
		expect(state.tables.processes.sortDesc).toBe(false);
	});
});

describe('handleKey: filtering', () => {
	it('/ starts a filter that typing extends and backspace shortens', () => {
		const {state} = press(start, ['/', 'a', 'b', 'c', {backspace: true}]);
		expect(state.editingFilter).toBe(true);
		expect(state.tables.processes.filter).toBe('ab');
	});

	it('keys that normally act are typed into the filter instead', () => {
		const {state, effect} = press(start, ['/', 'q', 't']);
		expect(state.tables.processes.filter).toBe('qt');
		expect(state.processFilters.tasks).toBe(true);
		expect(effect).toBeUndefined();
	});

	it('Enter keeps the filter; Esc clears it', () => {
		const kept = press(start, ['/', 'x', {return: true}]).state;
		expect(kept).toMatchObject({editingFilter: false});
		expect(kept.tables.processes.filter).toBe('x');
		expect(press(start, ['/', 'x', {escape: true}]).state.tables.processes.filter).toBe('');
		expect(press(kept, [{escape: true}]).state.tables.processes.filter).toBe('');
	});

	it('ignores control keys while typing', () => {
		expect(handleKey(press(start, ['/']).state, 'c', {ctrl: true}, context()).state.tables.processes.filter).toBe('');
	});
});

describe('handleKey: overlays', () => {
	it('Enter opens details for the selected row of the focused table', () => {
		expect(press(start, ['j', {return: true}]).state.overlay).toMatchObject({kind: 'process', row: {sessionId: 52}});
		expect(press(start, [{tab: true}, {return: true}]).state.overlay).toMatchObject({kind: 'active'});
		expect(press(start, [{tab: true}, 'e', {return: true}]).state.overlay).toMatchObject({kind: 'recent'});
	});

	it('Enter on an empty table opens nothing', () => {
		const empty = context({tables: {...context().tables, processes: {rows: [], columns: []}}});
		expect(press(start, [{return: true}], empty).state.overlay).toBeNull();
	});

	it('? opens help, which scrolls within bounds and closes with Esc or q', () => {
		const help = press(start, ['?']).state;
		expect(help.overlay).toEqual({kind: 'help'});
		expect(press(help, ['j', 'j']).state.overlayOffset).toBe(2);
		expect(press(help, [{pageDown: true}, {pageDown: true}, {pageDown: true}]).state.overlayOffset).toBe(10);
		expect(press(help, [{end: true}, {home: true}, 'k']).state.overlayOffset).toBe(0);
		expect(press(help, [{escape: true}]).state.overlay).toBeNull();
		expect(press(help, ['q']).state.overlay).toBeNull();
	});

	it('q inside an overlay closes it instead of quitting', () => {
		expect(press(start, ['?', 'q']).effect).toBeUndefined();
	});
});

describe('handleKey: effects', () => {
	it.each([
		['q', {type: 'quit'}],
		['r', {type: 'refresh'}],
		['p', {type: 'setPaused', paused: true}],
		['+', {type: 'setInterval', ms: 5000}],
		['-', {type: 'setInterval', ms: 1000}],
	])('%s → %o', (key, effect) => {
		expect(press(start, [key]).effect).toEqual(effect);
	});

	it('p resumes when paused', () => {
		expect(press(start, ['p'], context({paused: true})).effect).toEqual({type: 'setPaused', paused: false});
	});
});
