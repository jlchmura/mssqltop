import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Box, useApp, useInput, useWindowSize} from 'ink';
import {groupBySession, type ActiveQueryRow, type Monitor, type ProcessRow, type RecentQueryRow, type SessionDetail} from '../monitor.js';
import {activeColumns, processColumns, recentColumns} from '../columns.js';
import {fit, fmtCompact, fmtDuration, fmtInt, fmtKb, fmtRate, oneLine, productName} from '../format.js';
import {Chart} from './Chart.js';
import {Detail, renderBlocks, type DetailBlock} from './Detail.js';
import {Frame} from './Frame.js';
import {Line, segWidth, truncateSegs, type Seg} from './Line.js';
import {Table, scrollOffset, sortRows, type Column} from './Table.js';

type TableId = 'processes' | 'recent' | 'active';

interface TableView {
	sortId: string;
	sortDesc: boolean;
	filter: string;
	selectedKey: string | null;
	selected: number;
}

type Overlay =
	| {kind: 'help'}
	| {kind: 'process'; row: ProcessRow; detail?: SessionDetail; error?: string}
	| {kind: 'active'; row: ActiveQueryRow; detail?: SessionDetail; error?: string}
	| {kind: 'recent'; row: RecentQueryRow};

const INTERVALS = [1000, 2000, 5000, 10000, 30000, 60000];

const HELP: Array<[string, string]> = [
	['Tab / Shift-Tab', 'Switch between the Processes and Expensive Queries panels'],
	['↑ ↓ PgUp PgDn Home End', 'Move the selection (also j / k)'],
	['Enter', 'Details for the selected row: all columns plus the full SQL text'],
	['e  ← →', 'Toggle Recent / Active Expensive Queries'],
	['/', 'Filter the focused panel by text (Enter to keep, Esc to clear)'],
	['< >', 'Change the sort column of the focused panel'],
	['i', 'Invert the sort order'],
	['t', 'Processes: only rows with a Task State (hides idle sessions)'],
	['u', 'Processes: only user processes'],
	['b', 'Processes: only blocked sessions and head blockers'],
	['g', 'Processes: one row per session vs one row per task (SSMS style)'],
	['m', 'Maximize the focused panel'],
	['c', 'Show / hide the overview charts'],
	['p', 'Pause / resume refreshing'],
	['r', 'Refresh now'],
	['+ -', 'Lengthen / shorten the refresh interval'],
	['q  Ctrl-C', 'Quit'],
];

const matches = (needle: string, ...hay: Array<string | number | null>) =>
	!needle || hay.some(h => h != null && String(h).toLowerCase().includes(needle));

export function App({monitor, target}: {monitor: Monitor; target: string}) {
	const state = useSyncExternalStore(monitor.subscribe, monitor.getState);
	const {columns: width, rows: height} = useWindowSize();
	const {exit} = useApp();

	const [focus, setFocus] = useState<'processes' | 'queries'>('processes');
	const [queryTab, setQueryTab] = useState<'recent' | 'active'>('active');
	const [showCharts, setShowCharts] = useState(true);
	const [maximized, setMaximized] = useState(false);
	const [overlay, setOverlay] = useState<Overlay | null>(null);
	const [overlayOffset, setOverlayOffset] = useState(0);
	const [editingFilter, setEditingFilter] = useState(false);
	const [procFilters, setProcFilters] = useState({tasks: true, user: true, blocking: false, grouped: true});
	const [views, setViews] = useState<Record<TableId, TableView>>({
		processes: {sortId: 'spid', sortDesc: false, filter: '', selectedKey: null, selected: 0},
		recent: {sortId: 'cpu', sortDesc: true, filter: '', selectedKey: null, selected: 0},
		active: {sortId: 'cpu', sortDesc: true, filter: '', selectedKey: null, selected: 0},
	});
	const offsets = useRef<Record<TableId, number>>({processes: 0, recent: 0, active: 0});

	const focusedTable: TableId = focus === 'processes' ? 'processes' : queryTab;
	const patchView = (id: TableId, patch: Partial<TableView>) => setViews(v => ({...v, [id]: {...v[id], ...patch}}));

	// ---- derived rows -------------------------------------------------------------------------
	const procCols = processColumns(procFilters.grouped);
	const procAll = procFilters.grouped ? groupBySession(state.processes) : state.processes;
	const procNeedle = views.processes.filter.toLowerCase();
	const procRows = sortRows(
		procAll.filter(
			r =>
				(!procFilters.tasks || r.taskState !== '') &&
				(!procFilters.user || r.userProcess) &&
				(!procFilters.blocking || r.blockedBy !== null || r.headBlocker) &&
				matches(procNeedle, r.sessionId, r.login, r.database, r.command, r.application, r.host, r.waitType, r.taskState),
		),
		procCols.find(c => c.id === views.processes.sortId),
		views.processes.sortDesc,
		r => r.sessionId,
	);
	const recentNeedle = views.recent.filter.toLowerCase();
	const recentRows = sortRows(
		state.recent.filter(r => matches(recentNeedle, r.text, r.database)),
		recentColumns.find(c => c.id === views.recent.sortId),
		views.recent.sortDesc,
		() => 0,
	);
	const activeNeedle = views.active.filter.toLowerCase();
	const activeRows = sortRows(
		state.active.filter(r => matches(activeNeedle, r.text, r.database, r.sessionId, r.login, r.host, r.application, r.waitType)),
		activeColumns.find(c => c.id === views.active.sortId),
		views.active.sortDesc,
		r => r.sessionId,
	);

	const tables = {
		processes: {rows: procRows as Array<{key: string}>, columns: procCols as Column<any>[]},
		recent: {rows: recentRows as Array<{key: string}>, columns: recentColumns as Column<any>[]},
		active: {rows: activeRows as Array<{key: string}>, columns: activeColumns as Column<any>[]},
	};

	/** Follow the selected row by key across refreshes and re-sorts; fall back to its old index. */
	const selectedIndex = (id: TableId) => {
		const {rows} = tables[id];
		const v = views[id];
		const byKey = v.selectedKey ? rows.findIndex(r => r.key === v.selectedKey) : -1;
		return byKey >= 0 ? byKey : Math.max(0, Math.min(v.selected, rows.length - 1));
	};

	// ---- layout -------------------------------------------------------------------------------
	const chartsVisible = showCharts && !maximized && height >= 24;
	const chartH = chartsVisible ? Math.max(7, Math.min(12, Math.round(height * 0.2))) : 0;
	const bodyH = Math.max(0, height - 2 - chartH);
	let procH = Math.max(6, Math.round(bodyH * 0.55));
	let queryH = bodyH - procH;
	if (maximized) {
		procH = focus === 'processes' ? bodyH : 0;
		queryH = bodyH - procH;
	}
	const tableW = width - 2;
	const pageRows = (id: TableId) => Math.max(1, (id === 'processes' ? procH : queryH) - 3);

	// ---- overlay detail fetch -----------------------------------------------------------------
	useEffect(() => {
		if (!overlay || (overlay.kind !== 'process' && overlay.kind !== 'active') || overlay.detail || overlay.error) return;
		let live = true;
		const row = overlay.row;
		monitor
			.fetchSessionDetail(row.sessionId)
			.then(detail => live && setOverlay(o => (o && 'row' in o && o.row === row ? {...o, detail} : o)))
			.catch((err: Error) => live && setOverlay(o => (o && 'row' in o && o.row === row ? {...o, error: err.message} : o)));
		return () => {
			live = false;
		};
	}, [overlay, monitor]);

	const overlayContent = overlay ? buildOverlay(overlay, width - 4) : null;
	const overlayH = height - 2;
	const overlayMax = overlayContent ? Math.max(0, overlayContent.lines.length - (overlayH - 2)) : 0;

	// ---- input --------------------------------------------------------------------------------
	const moveSelection = (id: TableId, to: (cur: number, count: number) => number) => {
		const {rows} = tables[id];
		if (rows.length === 0) return;
		const next = Math.max(0, Math.min(rows.length - 1, to(selectedIndex(id), rows.length)));
		patchView(id, {selected: next, selectedKey: rows[next]!.key});
	};

	useInput((input, key) => {
		if (editingFilter) {
			const cur = views[focusedTable].filter;
			if (key.return) setEditingFilter(false);
			else if (key.escape) {
				patchView(focusedTable, {filter: ''});
				setEditingFilter(false);
			} else if (key.backspace || key.delete) patchView(focusedTable, {filter: cur.slice(0, -1)});
			else if (input && !key.ctrl && !key.meta && !key.tab) patchView(focusedTable, {filter: cur + input});
			return;
		}

		if (overlay) {
			const page = overlayH - 3;
			if (key.escape || key.return || input === 'q' || input === '?') setOverlay(null);
			else if (key.upArrow || input === 'k') setOverlayOffset(o => Math.max(0, o - 1));
			else if (key.downArrow || input === 'j') setOverlayOffset(o => Math.min(overlayMax, o + 1));
			else if (key.pageUp) setOverlayOffset(o => Math.max(0, o - page));
			else if (key.pageDown || input === ' ') setOverlayOffset(o => Math.min(overlayMax, o + page));
			else if (key.home) setOverlayOffset(0);
			else if (key.end) setOverlayOffset(overlayMax);
			return;
		}

		const id = focusedTable;
		const page = pageRows(id);
		if (input === 'q') exit();
		else if (key.tab) setFocus(f => (f === 'processes' ? 'queries' : 'processes'));
		else if (key.upArrow || input === 'k') moveSelection(id, c => c - 1);
		else if (key.downArrow || input === 'j') moveSelection(id, c => c + 1);
		else if (key.pageUp) moveSelection(id, c => c - page);
		else if (key.pageDown) moveSelection(id, c => c + page);
		else if (key.home) moveSelection(id, () => 0);
		else if (key.end) moveSelection(id, (_, n) => n - 1);
		else if (key.return) {
			const row = tables[id].rows[selectedIndex(id)];
			if (row) {
				setOverlayOffset(0);
				setOverlay(
					id === 'processes'
						? {kind: 'process', row: row as ProcessRow}
						: id === 'active'
							? {kind: 'active', row: row as ActiveQueryRow}
							: {kind: 'recent', row: row as RecentQueryRow},
				);
			}
		} else if (input === '?' || input === 'h') {
			setOverlayOffset(0);
			setOverlay({kind: 'help'});
		} else if (input === 'e' || (focus === 'queries' && (key.leftArrow || key.rightArrow))) {
			setQueryTab(t => (t === 'recent' ? 'active' : 'recent'));
		} else if (input === '/') setEditingFilter(true);
		else if (key.escape && views[id].filter) patchView(id, {filter: ''});
		else if (input === '<' || input === '>' || input === ',' || input === '.') {
			const cols = tables[id].columns;
			const i = cols.findIndex(c => c.id === views[id].sortId);
			const next = cols[(i + (input === '<' || input === ',' ? -1 : 1) + cols.length) % cols.length]!;
			patchView(id, {sortId: next.id, sortDesc: next.align === 'right'});
		} else if (input === 'i') patchView(id, {sortDesc: !views[id].sortDesc});
		else if (input === 't') setProcFilters(f => ({...f, tasks: !f.tasks}));
		else if (input === 'u') setProcFilters(f => ({...f, user: !f.user}));
		else if (input === 'b') setProcFilters(f => ({...f, blocking: !f.blocking}));
		else if (input === 'g') setProcFilters(f => ({...f, grouped: !f.grouped}));
		else if (input === 'm') setMaximized(m => !m);
		else if (input === 'c') setShowCharts(c => !c);
		else if (input === 'p') monitor.setPaused(!state.paused);
		else if (input === 'r') monitor.refreshNow();
		else if (input === '+' || input === '=' || input === '-' || input === '_') {
			const i = INTERVALS.findIndex(ms => ms >= state.intervalMs);
			const cur = i === -1 ? INTERVALS.length - 1 : i;
			const next = INTERVALS[Math.max(0, Math.min(INTERVALS.length - 1, cur + (input === '-' || input === '_' ? -1 : 1)))]!;
			monitor.setInterval(next);
		}
	});

	// ---- render -------------------------------------------------------------------------------
	const header = buildHeader(state, target, width);
	const footer = buildFooter(editingFilter, views[focusedTable].filter, focusedTable, width);

	if (overlay && overlayContent) {
		return (
			<Box flexDirection="column" width={width} height={height}>
				<Line segs={header} />
				<Detail title={overlayContent.title} lines={overlayContent.lines} width={width} height={overlayH} offset={Math.min(overlayOffset, overlayMax)} />
				<Line segs={footer} />
			</Box>
		);
	}

	const renderTable = (id: TableId, h: number, focused: boolean, empty: string) => {
		const {rows, columns} = tables[id];
		const sel = selectedIndex(id);
		const visible = Math.max(1, h - 3);
		const offset = scrollOffset(offsets.current[id], sel, visible, rows.length);
		offsets.current[id] = offset;
		return (
			<Table
				columns={columns}
				rows={rows}
				width={tableW}
				height={h - 2}
				selected={sel}
				offset={offset}
				focused={focused}
				sortId={views[id].sortId}
				sortDesc={views[id].sortDesc}
				emptyMessage={empty}
			/>
		);
	};

	const s = state.series;
	const last = (a: number[]) => a[a.length - 1];
	const chartW = Math.floor(width / 4);
	const procTitle = buildProcTitle(procRows.length, procAll.length, procFilters, views.processes.filter, focus === 'processes');
	const queryTitle = buildQueryTitle(queryTab, state, recentRows.length, activeRows.length, views[queryTab].filter, focus === 'queries');

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Line segs={header} />
			{chartsVisible ? (
				<Box flexDirection="row" height={chartH}>
					<Chart title="% Processor Time" shortTitle="CPU" current={last(s.cpu) == null ? '…' : `${Math.round(last(s.cpu)!)}%`} values={s.cpu} max={100} width={chartW} height={chartH} />
					<Chart title="Waiting Tasks" shortTitle="Waiting" current={last(s.waiting) == null ? '…' : fmtInt(last(s.waiting))} values={s.waiting} width={chartW} height={chartH} />
					<Chart title="Database I/O" shortTitle="DB I/O" current={last(s.io) == null ? '…' : `${fmtRate(last(s.io))} MB/s`} values={s.io} minMax={1} width={chartW} height={chartH} />
					<Chart title="Batch Requests/sec" shortTitle="Batches/s" current={last(s.batch) == null ? '…' : fmtCompact(last(s.batch)!)} values={s.batch} width={width - chartW * 3} height={chartH} />
				</Box>
			) : null}
			{procH > 0 ? (
				<Frame title={procTitle} width={width} height={procH} focused={focus === 'processes'}>
					{renderTable('processes', procH, focus === 'processes', state.lastUpdate ? 'No processes match the current filters' : 'Connecting…')}
				</Frame>
			) : null}
			{queryH > 0 ? (
				<Frame title={queryTitle} width={width} height={queryH} focused={focus === 'queries'}>
					{renderTable(
						queryTab,
						queryH,
						focus === 'queries',
						queryTab === 'recent'
							? state.recentReady
								? 'No queries completed in the window'
								: `Collecting a baseline from the plan cache…${state.recentError ? ` (${state.recentError})` : ''}`
							: 'No active requests',
					)}
				</Frame>
			) : null}
			<Line segs={footer} />
		</Box>
	);
}

// ---- header / footer / titles -------------------------------------------------------------------

function buildHeader(state: Monitor['state'], target: string, width: number): Seg[] {
	const srv = state.server;
	const left: Seg[] = [{text: ' mssqltop ', color: 'black', bg: 'cyan', bold: true}];
	if (srv) {
		left.push(
			{text: ` ${srv.name} `, bold: true},
			{text: `${productName(srv.productVersion, srv.productLevel)} · ${srv.edition.replace(/ Edition.*/, '')} · ${srv.productVersion}`, color: 'gray'},
			{text: ` · ${srv.cpuCount} CPUs · ${fmtKb(srv.memoryKb)} · up ${fmtDuration(Date.now() - srv.startedAt)}`, color: 'gray'},
		);
	} else {
		left.push({text: ` connecting to ${target}…`, color: 'gray'});
	}

	const right: Seg[] = [];
	if (state.error) right.push({text: ` ⚠ ${state.error} `, color: 'white', bg: 'red', bold: true});
	else if (state.paused) right.push({text: ' PAUSED ', color: 'black', bg: 'yellow', bold: true});
	else right.push({text: '● ', color: 'green'}, {text: `every ${state.intervalMs / 1000}s`, color: 'gray'});
	if (state.fastQueryMs != null) right.push({text: `  ${state.fastQueryMs}ms`, color: 'gray'});
	if (state.lastUpdate) right.push({text: `  ${new Date(state.lastUpdate).toLocaleTimeString('en-US', {hour12: false})} `, bold: true});

	return joinLeftRight(left, right, width);
}

/** Lays out left and right segments on one line, truncating the left side (then the right) to fit. */
function joinLeftRight(left: Seg[], right: Seg[], width: number): Seg[] {
	let rightW = segWidth(right);
	if (rightW > width) {
		right = [{...right[0]!, text: fit(right.map(s => s.text).join(''), width)}];
		rightW = width;
	}
	left = truncateSegs(left, width - rightW - 1);
	const pad = Math.max(0, width - segWidth(left) - rightW);
	return [...left, {text: ' '.repeat(pad)}, ...right];
}

function buildFooter(editing: boolean, filter: string, table: TableId, width: number): Seg[] {
	if (editing) {
		const label = table === 'processes' ? 'Processes' : table === 'recent' ? 'Recent queries' : 'Active queries';
		return [
			{text: ` Filter ${label}: `, color: 'black', bg: 'cyan', bold: true},
			{text: ` ${filter}`},
			{text: '█', color: 'cyan'},
			{text: fit('   Enter keep · Esc clear', Math.max(0, width - 24 - label.length - filter.length)), color: 'gray'},
		];
	}
	const keys: Array<[string, string]> = [
		['?', 'Help'],
		['Tab', 'Panel'],
		['↵', 'Details'],
		['/', 'Filter'],
		['<>', 'Sort'],
		['t', 'Tasks'],
		['u', 'User'],
		['b', 'Blocking'],
		['g', 'Group'],
		['e', 'Recent/Active'],
		['m', 'Max'],
		['c', 'Charts'],
		['p', 'Pause'],
		['+-', 'Interval'],
		['q', 'Quit'],
	];
	const segs: Seg[] = [];
	let used = 0;
	for (const [k, label] of keys) {
		const w = k.length + label.length + 1;
		if (used + w > width) break;
		segs.push({text: k, color: 'black', bg: 'cyan', bold: true}, {text: label + ' '});
		used += w;
	}
	return segs;
}

function badge(text: string): Seg {
	return {text: ` ${text} `, color: 'black', bg: 'yellow'};
}

function buildProcTitle(
	shown: number,
	total: number,
	f: {tasks: boolean; user: boolean; blocking: boolean; grouped: boolean},
	filter: string,
	focused: boolean,
): Seg[] {
	const segs: Seg[] = [
		{text: 'Processes', bold: true, color: focused ? 'cyan' : undefined},
		{text: ` ${shown} of ${total} ${f.grouped ? 'sessions' : 'tasks'} `, color: 'gray'},
	];
	if (f.tasks) segs.push(badge('Task State ≠ blank'), {text: ' '});
	if (f.user) segs.push(badge('User'), {text: ' '});
	if (f.blocking) segs.push(badge('Blocking'), {text: ' '});
	if (filter) segs.push(badge(`/${filter}`), {text: ' '});
	return segs;
}

function buildQueryTitle(
	tab: 'recent' | 'active',
	state: Monitor['state'],
	recentCount: number,
	activeCount: number,
	filter: string,
	focused: boolean,
): Seg[] {
	const tabSeg = (label: string, on: boolean): Seg =>
		on ? {text: ` ${label} `, color: 'black', bg: focused ? 'cyan' : 'white', bold: true} : {text: ` ${label} `, color: 'gray'};
	const segs: Seg[] = [
		tabSeg(`Recent Expensive Queries (${recentCount})`, tab === 'recent'),
		{text: ' '},
		tabSeg(`Active Expensive Queries (${activeCount})`, tab === 'active'),
	];
	if (tab === 'recent' && state.recentReady) segs.push({text: ` last ${Math.round(state.recentWindowSec)}s `, color: 'gray'});
	if (filter) segs.push({text: ' '}, badge(`/${filter}`));
	return segs;
}

// ---- overlays -----------------------------------------------------------------------------------

function buildOverlay(o: Overlay, width: number): {title: Seg[]; lines: Seg[][]} {
	if (o.kind === 'help') {
		const keyW = Math.max(...HELP.map(([k]) => k.length)) + 3;
		return {
			title: [{text: 'Help', bold: true, color: 'cyan'}, {text: '  Esc to close', color: 'gray'}],
			lines: [
				[{text: 'mssqltop — an htop-style take on the SSMS Activity Monitor', bold: true}],
				[],
				...HELP.map(([k, d]): Seg[] => [{text: fit(k, keyW), color: 'cyan', bold: true}, {text: fit(d, Math.max(0, width - keyW))}]),
				[],
				[{text: 'Charts: ', bold: true}, {text: 'SQL Server process CPU across all schedulers, user tasks waiting, data+log file', color: 'gray'}],
				[{text: '        I/O throughput, and batch requests per second. Each column of braille = 2 samples.', color: 'gray'}],
				[{text: 'Recent Expensive Queries: ', bold: true}, {text: 'plan-cache deltas grouped by query hash over a rolling window.', color: 'gray'}],
				[{text: 'Active Expensive Queries: ', bold: true}, {text: 'requests executing right now, with their memory grants.', color: 'gray'}],
			],
		};
	}

	let title: Seg[];
	let blocks: DetailBlock[];
	if (o.kind === 'process') {
		const r = o.row;
		title = [{text: `Session ${r.sessionId}`, bold: true, color: 'cyan'}, {text: `  ${r.login}  Esc to close`, color: 'gray'}];
		blocks = [
			{
				kind: 'fields',
				fields: [
					['Session ID', String(r.sessionId)],
					['Login', r.login],
					['Host', r.host],
					['Net Address', r.netAddress],
					['Application', r.application],
					['Database', r.database],
					['Session Status', r.sessionStatus],
					['Task State', r.taskState + (r.tasks > 1 ? `  (${r.tasks} tasks)` : '')],
					['Command', r.command],
					['Wait Type', r.waitType],
					['Wait Time (ms)', fmtInt(r.waitTimeMs)],
					['Wait Resource', r.waitResource],
					['Blocked By', r.blockedBy ? String(r.blockedBy) : ''],
					['Head Blocker', r.headBlocker ? 'yes' : ''],
					['Total CPU (ms)', fmtInt(r.cpuMs)],
					['Physical I/O', fmtInt(r.physicalIo)],
					['Logical Reads', fmtInt(r.logicalReads)],
					['Memory Use (KB)', fmtInt(r.memoryKb)],
					['Open Transactions', String(r.openTran)],
					['Login Time', r.loginTime],
					['Last Request Start', r.lastRequestStart],
					['Workload Group', r.workloadGroup],
				],
			},
			...sessionSqlBlocks(o.detail, o.error),
		];
	} else if (o.kind === 'active') {
		const r = o.row;
		const kb = (v: number | null) => (v == null ? '' : `${fmtInt(v)} KB`);
		title = [{text: `Active request · session ${r.sessionId}`, bold: true, color: 'cyan'}, {text: '  Esc to close', color: 'gray'}];
		blocks = [
			{
				kind: 'fields',
				fields: [
					['Session / Request', `${r.sessionId} / ${r.requestId}`],
					['Login', r.login],
					['Host', r.host],
					['Application', r.application],
					['Database', r.database],
					['Status', r.status],
					['Command', r.command],
					['Start Time', r.startTime],
					['Elapsed (ms)', fmtInt(r.elapsedMs)],
					['CPU (ms)', fmtInt(r.cpuMs)],
					['CPU (ms/sec)', fmtRate(r.cpuMsPerSec)],
					['Physical Reads', fmtInt(r.physicalReads)],
					['Writes', fmtInt(r.writes)],
					['Logical Reads', fmtInt(r.logicalReads)],
					['Row Count', fmtInt(r.rowCount)],
					['Wait Type', r.waitType],
					['Wait Time (ms)', fmtInt(r.waitTimeMs)],
					['Blocked By', r.blockedBy ? String(r.blockedBy) : ''],
					['DOP', r.dop == null ? '' : String(r.dop)],
					['Query Cost', r.queryCost == null ? '' : r.queryCost.toFixed(2)],
					['Memory Requested', kb(r.requestedKb)],
					['Memory Granted', kb(r.grantedKb)],
					['Memory Used / Max', r.usedKb == null ? '' : `${kb(r.usedKb)} / ${kb(r.maxUsedKb)}`],
					['Memory Required / Ideal', r.requiredKb == null ? '' : `${kb(r.requiredKb)} / ${kb(r.idealKb)}`],
					['Query Hash', r.queryHash],
				],
			},
			{kind: 'sql', title: 'Statement', text: r.text},
			...sessionSqlBlocks(o.detail, o.error, true),
		];
	} else {
		const r = o.row;
		title = [{text: 'Recent expensive query', bold: true, color: 'cyan'}, {text: '  Esc to close', color: 'gray'}];
		blocks = [
			{
				kind: 'fields',
				fields: [
					['Database', r.database],
					['Executions (window)', fmtInt(r.executions)],
					['Executions/min', fmtRate(r.execPerMin)],
					['CPU (ms/sec)', fmtRate(r.cpuMsPerSec)],
					['Avg CPU (ms)', fmtRate(r.avgCpuMs)],
					['Avg Duration (ms)', fmtRate(r.avgDurationMs)],
					['Physical Reads/sec', fmtRate(r.physicalReadsPerSec)],
					['Logical Writes/sec', fmtRate(r.logicalWritesPerSec)],
					['Logical Reads/sec', fmtRate(r.logicalReadsPerSec)],
					['Plan Count', String(r.planCount)],
					['Query Hash', r.key.startsWith('0x') && r.key.length <= 18 ? r.key : '(none — grouped by statement)'],
				],
			},
			{kind: 'sql', title: 'Statement', text: r.text},
		];
	}
	return {title, lines: renderBlocks(blocks, width)};
}

function sessionSqlBlocks(detail: SessionDetail | undefined, error: string | undefined, skipCurrent = false): DetailBlock[] {
	if (error) return [{kind: 'text', lines: [[], [{text: `Could not load SQL text: ${error}`, color: 'red'}]]}];
	if (!detail) return [{kind: 'text', lines: [[], [{text: 'Loading SQL text…', color: 'gray'}]]}];
	const blocks: DetailBlock[] = [];
	if (detail.currentStatement && !skipCurrent) blocks.push({kind: 'sql', title: 'Current statement', text: detail.currentStatement});
	if (detail.inputBuffer) blocks.push({kind: 'sql', title: 'Input buffer', text: detail.inputBuffer});
	if (detail.lastBatch && oneLine(detail.lastBatch) !== oneLine(detail.inputBuffer ?? '')) {
		blocks.push({kind: 'sql', title: 'Most recent batch', text: detail.lastBatch});
	}
	if (blocks.length === 0) blocks.push({kind: 'text', lines: [[], [{text: 'No SQL text available for this session.', color: 'gray'}]]});
	return blocks;
}
