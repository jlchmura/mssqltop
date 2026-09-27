/**
 * Everything the user controls (focus, sorting, filters, selection, overlays) and the key bindings
 * that change it. handleKey is a pure reducer so bindings can be tested without rendering.
 */
import type {ActiveQueryRow, ProcessRow, RecentQueryRow, SessionDetail} from '../monitor/types.js';
import type {Column} from './table-model.js';

export type TableId = 'processes' | 'recent' | 'active';
export type Panel = 'processes' | 'queries';
export type QueryTab = 'recent' | 'active';

export interface TableView {
	sortId: string;
	sortDesc: boolean;
	/** Free-text filter typed after `/`. */
	filter: string;
	/** Selection follows this row across refreshes; `selected` is the fallback index. */
	selectedKey: string | null;
	selected: number;
}

export interface ProcessFilters {
	/** Only rows with a Task State, i.e. hide idle sessions. */
	tasks: boolean;
	user: boolean;
	blocking: boolean;
	/** One row per session instead of one per task. */
	grouped: boolean;
}

export type Overlay =
	| {kind: 'help'}
	| {kind: 'process'; row: ProcessRow; detail?: SessionDetail; error?: string}
	| {kind: 'active'; row: ActiveQueryRow; detail?: SessionDetail; error?: string}
	| {kind: 'recent'; row: RecentQueryRow};

export interface ViewState {
	focus: Panel;
	queryTab: QueryTab;
	showCharts: boolean;
	maximized: boolean;
	overlay: Overlay | null;
	overlayOffset: number;
	editingFilter: boolean;
	processFilters: ProcessFilters;
	tables: Record<TableId, TableView>;
}

export function initialViewState(): ViewState {
	const table = (sortId: string, sortDesc: boolean): TableView => ({
		sortId,
		sortDesc,
		filter: '',
		selectedKey: null,
		selected: 0,
	});
	return {
		focus: 'processes',
		queryTab: 'active',
		showCharts: true,
		maximized: false,
		overlay: null,
		overlayOffset: 0,
		editingFilter: false,
		// Matches the SSMS filters most people set: user processes with a non-blank Task State.
		processFilters: {tasks: true, user: true, blocking: false, grouped: true},
		tables: {
			processes: table('spid', false),
			recent: table('cpu', true),
			active: table('cpu', true),
		},
	};
}

export const focusedTable = (s: ViewState): TableId => (s.focus === 'processes' ? 'processes' : s.queryTab);

/** Index of the selected row: follows its key across refreshes and re-sorts, else keeps the old index. */
export function selectedIndex(rows: readonly {key: string}[], view: TableView): number {
	const byKey = view.selectedKey ? rows.findIndex(r => r.key === view.selectedKey) : -1;
	return byKey >= 0 ? byKey : Math.max(0, Math.min(view.selected, rows.length - 1));
}

/** Refresh intervals `+` / `-` step through. */
export const INTERVALS_MS = [1000, 2000, 5000, 10000, 30000, 60000] as const;

export function stepInterval(current: number, direction: 1 | -1): number {
	const i = INTERVALS_MS.findIndex(ms => ms >= current);
	const cur = i === -1 ? INTERVALS_MS.length - 1 : i;
	return INTERVALS_MS[Math.max(0, Math.min(INTERVALS_MS.length - 1, cur + direction))]!;
}

/** The subset of Ink's Key that the bindings look at. */
export interface KeyPress {
	upArrow?: boolean;
	downArrow?: boolean;
	leftArrow?: boolean;
	rightArrow?: boolean;
	pageUp?: boolean;
	pageDown?: boolean;
	home?: boolean;
	end?: boolean;
	return?: boolean;
	escape?: boolean;
	tab?: boolean;
	backspace?: boolean;
	delete?: boolean;
	ctrl?: boolean;
	meta?: boolean;
}

/** What the reducer needs to know about the current screen. */
export interface KeyContext {
	tables: Record<TableId, {rows: readonly {key: string}[]; columns: readonly Column<any>[]}>;
	/** Rows a PgUp/PgDn moves in each table. */
	pageRows: Record<TableId, number>;
	/** Largest scroll offset and page size of the open overlay. */
	overlayMaxOffset: number;
	overlayPageRows: number;
	paused: boolean;
	intervalMs: number;
}

/** Side effects on the monitor or app that a key asks for. */
export type Effect =
	{type: 'quit'} | {type: 'refresh'} | {type: 'setPaused'; paused: boolean} | {type: 'setInterval'; ms: number};

export interface KeyResult {
	state: ViewState;
	effect?: Effect;
}

export function handleKey(s: ViewState, input: string, key: KeyPress, ctx: KeyContext): KeyResult {
	if (s.editingFilter) return {state: filterKey(s, input, key)};
	if (s.overlay) return {state: overlayKey(s, input, key, ctx)};
	return tableKey(s, input, key, ctx);
}

function patchTable(s: ViewState, id: TableId, patch: Partial<TableView>): ViewState {
	return {...s, tables: {...s.tables, [id]: {...s.tables[id], ...patch}}};
}

function filterKey(s: ViewState, input: string, key: KeyPress): ViewState {
	const id = focusedTable(s);
	const filter = s.tables[id].filter;
	if (key.return) return {...s, editingFilter: false};
	if (key.escape) return {...patchTable(s, id, {filter: ''}), editingFilter: false};
	if (key.backspace || key.delete) return patchTable(s, id, {filter: filter.slice(0, -1)});
	if (input && !key.ctrl && !key.meta && !key.tab) return patchTable(s, id, {filter: filter + input});
	return s;
}

function overlayKey(s: ViewState, input: string, key: KeyPress, ctx: KeyContext): ViewState {
	const scrollTo = (offset: number) => ({...s, overlayOffset: Math.max(0, Math.min(ctx.overlayMaxOffset, offset))});
	if (key.escape || key.return || input === 'q' || input === '?') return {...s, overlay: null, overlayOffset: 0};
	if (key.upArrow || input === 'k') return scrollTo(s.overlayOffset - 1);
	if (key.downArrow || input === 'j') return scrollTo(s.overlayOffset + 1);
	if (key.pageUp) return scrollTo(s.overlayOffset - ctx.overlayPageRows);
	if (key.pageDown || input === ' ') return scrollTo(s.overlayOffset + ctx.overlayPageRows);
	if (key.home) return scrollTo(0);
	if (key.end) return scrollTo(ctx.overlayMaxOffset);
	return s;
}

function tableKey(s: ViewState, input: string, key: KeyPress, ctx: KeyContext): KeyResult {
	const id = focusedTable(s);
	const view = s.tables[id];
	const {rows, columns} = ctx.tables[id];
	const page = ctx.pageRows[id];

	const moveTo = (to: (current: number) => number): KeyResult => {
		if (rows.length === 0) return {state: s};
		const next = Math.max(0, Math.min(rows.length - 1, to(selectedIndex(rows, view))));
		return {state: patchTable(s, id, {selected: next, selectedKey: rows[next]!.key})};
	};
	const toggleFilter = (name: keyof ProcessFilters): KeyResult => ({
		state: {...s, processFilters: {...s.processFilters, [name]: !s.processFilters[name]}},
	});

	if (input === 'q') return {state: s, effect: {type: 'quit'}};
	if (key.tab) return {state: {...s, focus: s.focus === 'processes' ? 'queries' : 'processes'}};
	if (key.upArrow || input === 'k') return moveTo(i => i - 1);
	if (key.downArrow || input === 'j') return moveTo(i => i + 1);
	if (key.pageUp) return moveTo(i => i - page);
	if (key.pageDown) return moveTo(i => i + page);
	if (key.home) return moveTo(() => 0);
	if (key.end) return moveTo(() => rows.length - 1);
	if (key.return) return {state: openDetail(s, id, rows[selectedIndex(rows, view)])};
	if (input === '?' || input === 'h') return {state: {...s, overlay: {kind: 'help'}, overlayOffset: 0}};
	if (input === 'e' || (s.focus === 'queries' && (key.leftArrow || key.rightArrow))) {
		return {state: {...s, queryTab: s.queryTab === 'recent' ? 'active' : 'recent'}};
	}
	if (input === '/') return {state: {...s, editingFilter: true}};
	if (key.escape && view.filter) return {state: patchTable(s, id, {filter: ''})};
	if (input === '<' || input === ',' || input === '>' || input === '.') {
		if (columns.length === 0) return {state: s};
		const i = columns.findIndex(c => c.id === view.sortId);
		const step = input === '<' || input === ',' ? -1 : 1;
		const next = columns[(i + step + columns.length) % columns.length]!;
		// Numeric (right-aligned) columns are most useful biggest-first.
		return {state: patchTable(s, id, {sortId: next.id, sortDesc: next.align === 'right'})};
	}
	if (input === 'i') return {state: patchTable(s, id, {sortDesc: !view.sortDesc})};
	if (input === 't') return toggleFilter('tasks');
	if (input === 'u') return toggleFilter('user');
	if (input === 'b') return toggleFilter('blocking');
	if (input === 'g') return toggleFilter('grouped');
	if (input === 'm') return {state: {...s, maximized: !s.maximized}};
	if (input === 'c') return {state: {...s, showCharts: !s.showCharts}};
	if (input === 'p') return {state: s, effect: {type: 'setPaused', paused: !ctx.paused}};
	if (input === 'r') return {state: s, effect: {type: 'refresh'}};
	if (input === '+' || input === '=')
		return {state: s, effect: {type: 'setInterval', ms: stepInterval(ctx.intervalMs, 1)}};
	if (input === '-' || input === '_')
		return {state: s, effect: {type: 'setInterval', ms: stepInterval(ctx.intervalMs, -1)}};
	return {state: s};
}

function openDetail(s: ViewState, id: TableId, row: {key: string} | undefined): ViewState {
	if (!row) return s;
	const overlay: Overlay =
		id === 'processes'
			? {kind: 'process', row: row as ProcessRow}
			: id === 'active'
				? {kind: 'active', row: row as ActiveQueryRow}
				: {kind: 'recent', row: row as RecentQueryRow};
	return {...s, overlay, overlayOffset: 0};
}
