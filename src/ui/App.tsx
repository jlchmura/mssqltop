import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Box, useApp, useInput, useWindowSize} from 'ink';
import {errorMessage} from '../db/values.js';
import type {FetchedPlan, MonitorState, PlanTarget, SessionDetail} from '../monitor/types.js';
import {parseShowplan} from '../plan/showplan.js';
import {DEFAULT_GRAPH_STYLE, HEAT, type GraphStyle} from './chart.js';
import {buildFooter, buildHeader, buildProcessesTitle, buildQueriesTitle} from './chrome.js';
import {Chart} from './components/Chart.js';
import {Detail} from './components/Detail.js';
import {Frame} from './components/Frame.js';
import {Line} from './components/Line.js';
import {Table} from './components/Table.js';
import {deriveTables} from './derive.js';
import {fmtCompact, fmtInt, fmtRate} from './format.js';
import {computeLayout, visibleRows} from './layout.js';
import {buildOverlay} from './overlays.js';
import {planFileName} from './plan-view.js';
import {scrollOffset} from './table-model.js';
import {
	focusedTable,
	handleKey,
	initialViewState,
	selectedIndex,
	type Effect,
	type Overlay,
	type QueryOverlay,
	type TableId,
} from './view-state.js';

/** The parts of Monitor the UI uses; tests pass a fake. */
export interface MonitorHandle {
	subscribe(listener: () => void): () => void;
	getState(): MonitorState;
	fetchSessionDetail(sessionId: number): Promise<SessionDetail>;
	fetchPlan(target: PlanTarget): Promise<FetchedPlan | null>;
	setPaused(paused: boolean): void;
	setInterval(intervalMs: number): void;
	refreshNow(): void;
}

interface Props {
	monitor: MonitorHandle;
	/** Server being monitored, shown while connecting. */
	target: string;
	/** How the overview charts are drawn. */
	graphStyle?: GraphStyle;
	/** Where `s` saves execution plans (default: the current directory). */
	planDir?: string;
}

export function App({monitor, target, graphStyle = DEFAULT_GRAPH_STYLE, planDir = process.cwd()}: Props) {
	const state = useSyncExternalStore(monitor.subscribe, monitor.getState);
	const {columns: width, rows} = useWindowSize();
	// Ink clears the whole Windows console on every frame that fills the screen, which flickers;
	// staying one row short keeps it on the incremental-update path.
	const height = process.platform === 'win32' ? rows - 1 : rows;
	const {exit} = useApp();
	const [view, setView] = useState(initialViewState);
	const scrollOffsets = useRef<Record<TableId, number>>({processes: 0, recent: 0, active: 0});

	const tables = deriveTables(state, view);
	const layout = computeLayout({
		width,
		height,
		showCharts: view.showCharts,
		maximized: view.maximized,
		focus: view.focus,
	});
	const overlay = view.overlay ? buildOverlay(view.overlay, width - 4) : null;
	const overlayMaxOffset = overlay ? Math.max(0, overlay.lines.length - (layout.overlayHeight - 2)) : 0;

	const replaceOverlay = ({overlay, next}: {overlay: Overlay; next: Overlay}) =>
		setView(v => (v.overlay === overlay ? {...v, overlay: next} : v));
	useSessionDetail(view.overlay, monitor, replaceOverlay);
	useQueryPlan(view.overlay, monitor, replaceOverlay);

	useInput((input, key) => {
		const {state: next, effect} = handleKey(view, input, key, {
			tables,
			pageRows: {
				processes: visibleRows(layout.processesHeight),
				recent: visibleRows(layout.queriesHeight),
				active: visibleRows(layout.queriesHeight),
			},
			overlayMaxOffset,
			overlayPageRows: Math.max(1, layout.overlayHeight - 3),
			paused: state.paused,
			intervalMs: state.intervalMs,
		});
		setView(next);
		if (effect) runEffect(effect);
	});

	const runEffect = (effect: Effect) => {
		switch (effect.type) {
			case 'quit':
				return exit();
			case 'refresh':
				return monitor.refreshNow();
			case 'setPaused':
				return monitor.setPaused(effect.paused);
			case 'setInterval':
				return monitor.setInterval(effect.ms);
			case 'savePlan':
				return savePlan();
		}
	};

	const savePlan = () => {
		const overlay = view.overlay;
		if (!overlay || (overlay.kind !== 'active' && overlay.kind !== 'recent') || !overlay.plan) return;
		const path = join(planDir, planFileName(overlay, new Date()));
		let planSaved: QueryOverlay['planSaved'];
		try {
			writeFileSync(path, overlay.plan.xml, 'utf8');
			planSaved = {path};
		} catch (err) {
			planSaved = {error: errorMessage(err)};
		}
		replaceOverlay({overlay, next: {...overlay, planSaved}});
	};

	const header = <Line segs={buildHeader(state, target, width, Date.now())} />;
	const footer = (
		<Line segs={buildFooter(view.editingFilter, view.tables[focusedTable(view)].filter, focusedTable(view), width)} />
	);

	if (overlay) {
		return (
			<Box flexDirection="column" width={width} height={height}>
				{header}
				<Detail
					title={overlay.title}
					lines={overlay.lines}
					width={width}
					height={layout.overlayHeight}
					offset={Math.min(view.overlayOffset, overlayMaxOffset)}
				/>
				{footer}
			</Box>
		);
	}

	const renderTable = (id: TableId, panelHeight: number, focused: boolean, emptyMessage: string) => {
		const {rows, columns} = tables[id];
		const selected = selectedIndex(rows, view.tables[id]);
		const offset = scrollOffset(scrollOffsets.current[id], selected, visibleRows(panelHeight), rows.length);
		scrollOffsets.current[id] = offset;
		return (
			<Table<any>
				columns={columns}
				rows={rows}
				width={width - 2}
				height={panelHeight - 2}
				selected={selected}
				offset={offset}
				focused={focused}
				sortId={view.tables[id].sortId}
				sortDesc={view.tables[id].sortDesc}
				emptyMessage={emptyMessage}
			/>
		);
	};

	const {series} = state;
	const latest = (values: number[], format: (v: number) => string) =>
		values.length ? format(values[values.length - 1]!) : '…';
	const [cpuW, waitW, ioW, batchW] = layout.chartWidths;
	const processesFocused = view.focus === 'processes';
	const queryTab = view.queryTab;

	return (
		<Box flexDirection="column" width={width} height={height}>
			{header}
			{layout.chartsVisible ? (
				<Box flexDirection="row" height={layout.chartHeight}>
					<Chart
						style={graphStyle}
						title="% Processor Time"
						shortTitle="CPU"
						current={latest(series.cpu, v => `${Math.round(v)}%`)}
						values={series.cpu}
						max={100}
						gradient={HEAT}
						width={cpuW}
						height={layout.chartHeight}
					/>
					<Chart
						style={graphStyle}
						title="Waiting Tasks"
						shortTitle="Waiting"
						current={latest(series.waiting, fmtInt)}
						values={series.waiting}
						width={waitW}
						height={layout.chartHeight}
					/>
					<Chart
						style={graphStyle}
						title="Database I/O"
						shortTitle="DB I/O"
						current={latest(series.io, v => `${fmtRate(v)} MB/s`)}
						values={series.io}
						minMax={1}
						width={ioW}
						height={layout.chartHeight}
					/>
					<Chart
						style={graphStyle}
						title="Batch Requests/sec"
						shortTitle="Batches/s"
						current={latest(series.batch, fmtCompact)}
						values={series.batch}
						width={batchW}
						height={layout.chartHeight}
					/>
				</Box>
			) : null}
			{layout.processesHeight > 0 ? (
				<Frame
					title={buildProcessesTitle(
						tables.processes.rows.length,
						tables.processes.total,
						view.processFilters,
						view.tables.processes.filter,
						processesFocused,
					)}
					width={width}
					height={layout.processesHeight}
					focused={processesFocused}
				>
					{renderTable(
						'processes',
						layout.processesHeight,
						processesFocused,
						state.lastUpdate ? 'No processes match the current filters' : 'Connecting…',
					)}
				</Frame>
			) : null}
			{layout.queriesHeight > 0 ? (
				<Frame
					title={buildQueriesTitle(
						queryTab,
						{recent: tables.recent.rows.length, active: tables.active.rows.length},
						state.recentReady ? state.recentWindowSec : null,
						view.tables[queryTab].filter,
						!processesFocused,
					)}
					width={width}
					height={layout.queriesHeight}
					focused={!processesFocused}
				>
					{renderTable(queryTab, layout.queriesHeight, !processesFocused, emptyQueriesMessage(queryTab, state))}
				</Frame>
			) : null}
			{footer}
		</Box>
	);
}

function emptyQueriesMessage(tab: 'recent' | 'active', state: MonitorState): string {
	if (tab === 'active') return 'No active requests';
	if (state.recentReady) return 'No queries completed in the window';
	return `Collecting a baseline from the plan cache…${state.recentError ? ` (${state.recentError})` : ''}`;
}

type OverlayUpdate = (update: {overlay: Overlay; next: Overlay}) => void;

/** Loads a session's SQL text when a process/active detail overlay opens without it. */
function useSessionDetail(overlay: Overlay | null, monitor: MonitorHandle, apply: OverlayUpdate) {
	useEffect(() => {
		if (!overlay || (overlay.kind !== 'process' && overlay.kind !== 'active')) return;
		if (overlay.detail || overlay.error) return;
		let live = true;
		monitor.fetchSessionDetail(overlay.row.sessionId).then(
			detail => live && apply({overlay, next: {...overlay, detail}}),
			(err: unknown) => live && apply({overlay, next: {...overlay, error: errorMessage(err)}}),
		);
		return () => {
			live = false;
		};
		// `apply` is a fresh closure every render; re-running on it would refetch constantly.
	}, [overlay, monitor]);
}

/** Loads and parses the execution plan the first time a query overlay switches to it. */
function useQueryPlan(overlay: Overlay | null, monitor: MonitorHandle, apply: OverlayUpdate) {
	useEffect(() => {
		if (!overlay || (overlay.kind !== 'active' && overlay.kind !== 'recent') || !overlay.showPlan) return;
		if (overlay.plan !== undefined || overlay.planError) return;
		const target: PlanTarget =
			overlay.kind === 'active'
				? {kind: 'active', sessionId: overlay.row.sessionId, requestId: overlay.row.requestId}
				: {kind: 'recent', key: overlay.row.key};
		let live = true;
		monitor.fetchPlan(target).then(
			fetched => {
				if (!live) return;
				try {
					const plan = fetched && {...fetched, statements: parseShowplan(fetched.xml)};
					apply({overlay, next: {...overlay, plan}});
				} catch (err) {
					apply({overlay, next: {...overlay, planError: `the plan XML could not be read (${errorMessage(err)})`}});
				}
			},
			(err: unknown) => live && apply({overlay, next: {...overlay, planError: errorMessage(err)}}),
		);
		return () => {
			live = false;
		};
		// `apply` is a fresh closure every render; re-running on it would refetch constantly.
	}, [overlay, monitor]);
}
