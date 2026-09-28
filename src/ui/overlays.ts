/** Content of the full-screen overlays: help and the per-row detail views. */
import type {ActiveQueryRow, ProcessRow, RecentQueryRow, SessionDetail} from '../monitor/types.js';
import {fit, fmtInt, fmtRate, oneLine, wrap} from './format.js';
import type {Seg} from './segments.js';
import {highlightSql} from './sql-highlight.js';
import type {Overlay} from './view-state.js';

export interface OverlayContent {
	title: Seg[];
	lines: Seg[][];
}

/** A section of a detail view. */
export type DetailBlock =
	| {kind: 'fields'; fields: Array<[label: string, value: string]>}
	| {kind: 'sql'; title: string; text: string}
	| {kind: 'text'; lines: Seg[][]};

export const HELP: ReadonlyArray<readonly [keys: string, description: string]> = [
	['Tab', 'Switch between the Processes and Expensive Queries panels'],
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

const closeHint: Seg = {text: '  Esc to close', color: 'gray'};

/** Builds an overlay's title and lines for a content area `width` columns wide. */
export function buildOverlay(o: Overlay, width: number): OverlayContent {
	switch (o.kind) {
		case 'help':
			return helpOverlay(width);
		case 'process':
			return {
				title: [
					{text: `Session ${o.row.sessionId}`, bold: true, color: 'cyan'},
					{text: `  ${o.row.login}`, color: 'gray'},
					closeHint,
				],
				lines: renderBlocks([processFields(o.row), ...sessionSqlBlocks(o.detail, o.error)], width),
			};
		case 'active':
			return {
				title: [{text: `Active request · session ${o.row.sessionId}`, bold: true, color: 'cyan'}, closeHint],
				lines: renderBlocks(
					[
						activeFields(o.row),
						{kind: 'sql', title: 'Statement', text: o.row.text},
						...sessionSqlBlocks(o.detail, o.error, true),
					],
					width,
				),
			};
		case 'recent':
			return {
				title: [{text: 'Recent expensive query', bold: true, color: 'cyan'}, closeHint],
				lines: renderBlocks([recentFields(o.row), {kind: 'sql', title: 'Statement', text: o.row.text}], width),
			};
	}
}

function helpOverlay(width: number): OverlayContent {
	const keyW = Math.max(...HELP.map(([k]) => k.length)) + 3;
	const note = (label: string, text: string): Seg[] => [
		{text: label, bold: true},
		{text, color: 'gray'},
	];
	return {
		title: [{text: 'Help', bold: true, color: 'cyan'}, closeHint],
		lines: [
			[{text: 'mssqltop — an htop-style take on the SSMS Activity Monitor', bold: true}],
			[],
			...HELP.map(([k, d]): Seg[] => [
				{text: fit(k, keyW), color: 'cyan', bold: true},
				{text: fit(d, Math.max(0, width - keyW))},
			]),
			[],
			note('Charts: ', 'SQL Server process CPU across all schedulers, user tasks waiting, data+log file'),
			note('        ', 'I/O throughput, and batch requests per second. Each character = 2 samples.'),
			note('Recent Expensive Queries: ', 'plan-cache deltas grouped by query hash over a rolling window.'),
			note('Active Expensive Queries: ', 'requests executing right now, with their memory grants.'),
		],
	};
}

function processFields(r: ProcessRow): DetailBlock {
	return {
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
	};
}

function activeFields(r: ActiveQueryRow): DetailBlock {
	const kb = (v: number | null) => (v == null ? '' : `${fmtInt(v)} KB`);
	return {
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
	};
}

function recentFields(r: RecentQueryRow): DetailBlock {
	const isHash = /^0x[0-9A-F]{16}$/i.test(r.key);
	return {
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
			['Query Hash', isHash ? r.key : '(none — grouped by statement)'],
		],
	};
}

/** SQL sections for a session: current statement, input buffer, and the last batch if it differs. */
export function sessionSqlBlocks(
	detail: SessionDetail | undefined,
	error: string | undefined,
	skipCurrent = false,
): DetailBlock[] {
	const message = (text: string, color: string): DetailBlock => ({kind: 'text', lines: [[], [{text, color}]]});
	if (error) return [message(`Could not load SQL text: ${error}`, 'red')];
	if (!detail) return [message('Loading SQL text…', 'gray')];
	const blocks: DetailBlock[] = [];
	if (detail.currentStatement && !skipCurrent)
		blocks.push({kind: 'sql', title: 'Current statement', text: detail.currentStatement});
	if (detail.inputBuffer) blocks.push({kind: 'sql', title: 'Input buffer', text: detail.inputBuffer});
	if (detail.lastBatch && oneLine(detail.lastBatch) !== oneLine(detail.inputBuffer ?? '')) {
		blocks.push({kind: 'sql', title: 'Most recent batch', text: detail.lastBatch});
	}
	return blocks.length ? blocks : [message('No SQL text available for this session.', 'gray')];
}

/** Lays detail blocks out as lines `width` columns wide. */
export function renderBlocks(blocks: readonly DetailBlock[], width: number): Seg[][] {
	const out: Seg[][] = [];
	for (const block of blocks) {
		switch (block.kind) {
			case 'fields': {
				const labelW = Math.max(...block.fields.map(([k]) => k.length)) + 2;
				for (const [label, value] of block.fields) {
					wrap(value, Math.max(10, width - labelW)).forEach((line, i) =>
						out.push([{text: fit(i === 0 ? label : '', labelW), color: 'cyan'}, {text: line}]),
					);
				}
				break;
			}
			case 'sql': {
				const heading = `── ${block.title} `;
				out.push([], [{text: heading + '─'.repeat(Math.max(0, width - heading.length)), color: 'green', bold: true}]);
				const text = block.text.replace(/^(\s*\n)+/, '').trimEnd();
				out.push(...highlightSql(wrap(text || '(none)', width)));
				break;
			}
			case 'text':
				out.push(...block.lines);
				break;
		}
	}
	return out;
}
