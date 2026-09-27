/** Turns monitor data plus view settings into the rows each grid shows. */
import {groupBySession} from '../monitor/group.js';
import type {ActiveQueryRow, MonitorState, ProcessRow, RecentQueryRow} from '../monitor/types.js';
import {activeColumns, processColumns, recentColumns} from './columns.js';
import {sortRows, type Column} from './table-model.js';
import type {ProcessFilters, TableView, ViewState} from './view-state.js';

export interface TableData<T> {
	rows: T[];
	columns: Column<T>[];
}

export interface Tables {
	processes: TableData<ProcessRow> & {
		/** Rows before any filter, for the "N of M" count. */
		total: number;
	};
	recent: TableData<RecentQueryRow>;
	active: TableData<ActiveQueryRow>;
}

/** Case-insensitive substring match of `needle` against any of the fields; an empty needle matches all. */
export function matchesFilter(needle: string, ...fields: Array<string | number | null>): boolean {
	const n = needle.toLowerCase();
	return !n || fields.some(f => f != null && String(f).toLowerCase().includes(n));
}

export function filterProcesses(rows: readonly ProcessRow[], f: ProcessFilters, text: string): ProcessRow[] {
	return rows.filter(
		r =>
			(!f.tasks || r.taskState !== '') &&
			(!f.user || r.userProcess) &&
			(!f.blocking || r.blockedBy !== null || r.headBlocker) &&
			matchesFilter(text, r.sessionId, r.login, r.database, r.command, r.application, r.host, r.waitType, r.taskState),
	);
}

function sorted<T>(rows: T[], columns: Column<T>[], view: TableView, tiebreak: (row: T) => number): T[] {
	return sortRows(
		rows,
		columns.find(c => c.id === view.sortId),
		view.sortDesc,
		tiebreak,
	);
}

export function deriveTables(state: MonitorState, view: ViewState): Tables {
	const {processFilters: pf, tables: t} = view;
	const processes = pf.grouped ? groupBySession(state.processes) : state.processes;
	const procCols = processColumns(pf.grouped);
	return {
		processes: {
			rows: sorted(filterProcesses(processes, pf, t.processes.filter), procCols, t.processes, r => r.sessionId),
			columns: procCols,
			total: processes.length,
		},
		recent: {
			rows: sorted(
				state.recent.filter(r => matchesFilter(t.recent.filter, r.text, r.database)),
				recentColumns,
				t.recent,
				() => 0,
			),
			columns: recentColumns,
		},
		active: {
			rows: sorted(
				state.active.filter(r =>
					matchesFilter(t.active.filter, r.text, r.database, r.sessionId, r.login, r.host, r.application, r.waitType),
				),
				activeColumns,
				t.active,
				r => r.sessionId,
			),
			columns: activeColumns,
		},
	};
}
