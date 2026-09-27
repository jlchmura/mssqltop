/** The header bar, footer key hints and panel titles. */
import type {MonitorState} from '../monitor/types.js';
import {fit, fmtDuration, fmtKb, productName} from './format.js';
import {joinLeftRight, type Seg} from './segments.js';
import type {ProcessFilters, QueryTab, TableId} from './view-state.js';

export function buildHeader(state: MonitorState, target: string, width: number, now: number): Seg[] {
	const srv = state.server;
	const left: Seg[] = [{text: ' mssqltop ', color: 'black', bg: 'cyan', bold: true}];
	if (srv) {
		const edition = srv.edition.replace(/ Edition.*/, '');
		left.push(
			{text: ` ${srv.name} `, bold: true},
			{
				text: `${productName(srv.productVersion, srv.productLevel)} · ${edition} · ${srv.productVersion}`,
				color: 'gray',
			},
			{
				text: ` · ${srv.cpuCount} CPUs · ${fmtKb(srv.memoryKb)} · up ${fmtDuration(now - srv.startedAt)}`,
				color: 'gray',
			},
		);
	} else {
		left.push({text: ` connecting to ${target}…`, color: 'gray'});
	}

	const right: Seg[] = [];
	if (state.error) right.push({text: ` ⚠ ${state.error} `, color: 'white', bg: 'red', bold: true});
	else if (state.paused) right.push({text: ' PAUSED ', color: 'black', bg: 'yellow', bold: true});
	else right.push({text: '● ', color: 'green'}, {text: `every ${state.intervalMs / 1000}s`, color: 'gray'});
	if (state.fastQueryMs != null) right.push({text: `  ${state.fastQueryMs}ms`, color: 'gray'});
	if (state.lastUpdate) right.push({text: `  ${clockTime(state.lastUpdate)} `, bold: true});

	return joinLeftRight(left, right, width);
}

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', {hour12: false});

export const FOOTER_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
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

const TABLE_LABELS: Record<TableId, string> = {
	processes: 'Processes',
	recent: 'Recent queries',
	active: 'Active queries',
};

/** Key hints, or the filter prompt while typing a filter. Hints that don't fit are dropped. */
export function buildFooter(editingFilter: boolean, filter: string, table: TableId, width: number): Seg[] {
	if (editingFilter) {
		const prompt = ` Filter ${TABLE_LABELS[table]}: `;
		const used = prompt.length + filter.length + 2;
		return [
			{text: prompt, color: 'black', bg: 'cyan', bold: true},
			{text: ` ${filter}`},
			{text: '█', color: 'cyan'},
			{text: fit('   Enter keep · Esc clear', Math.max(0, width - used)), color: 'gray'},
		];
	}
	const segs: Seg[] = [];
	let used = 0;
	for (const [key, label] of FOOTER_KEYS) {
		const w = key.length + label.length + 1;
		if (used + w > width) break;
		segs.push({text: key, color: 'black', bg: 'cyan', bold: true}, {text: label + ' '});
		used += w;
	}
	return segs;
}

const badge = (text: string): Seg => ({text: ` ${text} `, color: 'black', bg: 'yellow'});

export function buildProcessesTitle(
	shown: number,
	total: number,
	f: ProcessFilters,
	filter: string,
	focused: boolean,
): Seg[] {
	const segs: Seg[] = [
		{text: 'Processes', bold: true, color: focused ? 'cyan' : undefined},
		{text: ` ${shown} of ${total} ${f.grouped ? 'sessions' : 'tasks'} `, color: 'gray'},
	];
	const badges = [
		f.tasks && 'Task State ≠ blank',
		f.user && 'User',
		f.blocking && 'Blocking',
		filter && `/${filter}`,
	].filter((b): b is string => Boolean(b));
	for (const b of badges) segs.push(badge(b), {text: ' '});
	return segs;
}

export function buildQueriesTitle(
	tab: QueryTab,
	counts: {recent: number; active: number},
	recentWindowSec: number | null,
	filter: string,
	focused: boolean,
): Seg[] {
	const tabSeg = (label: string, on: boolean): Seg =>
		on
			? {text: ` ${label} `, color: 'black', bg: focused ? 'cyan' : 'white', bold: true}
			: {text: ` ${label} `, color: 'gray'};
	const segs: Seg[] = [
		tabSeg(`Recent Expensive Queries (${counts.recent})`, tab === 'recent'),
		{text: ' '},
		tabSeg(`Active Expensive Queries (${counts.active})`, tab === 'active'),
	];
	if (tab === 'recent' && recentWindowSec != null)
		segs.push({text: ` last ${Math.round(recentWindowSec)}s `, color: 'gray'});
	if (filter) segs.push({text: ' '}, badge(`/${filter}`));
	return segs;
}
