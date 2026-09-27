import type {Column} from './components/Table.js';
import type {ActiveQueryRow, ProcessRow, RecentQueryRow} from './monitor.js';
import {fmtInt, fmtRate, oneLine} from './format.js';

const TASK_STATE_COLORS: Record<string, string> = {
	RUNNING: 'green',
	RUNNABLE: 'yellow',
	SUSPENDED: 'blue',
	SPINLOOP: 'magenta',
};

const int = (v: number | null) => fmtInt(v);

export function processColumns(grouped: boolean): Column<ProcessRow>[] {
	const cols: Column<ProcessRow>[] = [
		{id: 'spid', title: 'SPID', width: 5, align: 'right', priority: 0, value: r => r.sessionId},
		{id: 'user', title: 'U', width: 1, priority: 6, value: r => (r.userProcess ? 1 : 0)},
		{id: 'login', title: 'Login', width: 12, flex: 2, priority: 1, value: r => r.login},
		{id: 'database', title: 'Database', width: 12, flex: 2, priority: 1, value: r => r.database},
		{
			id: 'task',
			title: 'Task State',
			width: 10,
			priority: 0,
			value: r => r.taskState,
			color: r => TASK_STATE_COLORS[r.taskState],
		},
		{id: 'command', title: 'Command', width: 11, flex: 1, priority: 1, value: r => r.command},
		{id: 'app', title: 'Application', width: 12, flex: 2, priority: 2, value: r => r.application},
		{id: 'waitms', title: 'Wait ms', width: 9, align: 'right', priority: 2, value: r => r.waitTimeMs, text: r => int(r.waitTimeMs)},
		{id: 'waittype', title: 'Wait Type', width: 13, flex: 1, priority: 2, value: r => r.waitType, color: r => (r.waitType ? 'yellow' : undefined)},
		{id: 'waitres', title: 'Wait Resource', width: 13, flex: 1, priority: 7, value: r => r.waitResource},
		{
			id: 'blockedby',
			title: 'Blk By',
			width: 6,
			align: 'right',
			priority: 3,
			value: r => r.blockedBy,
			color: r => (r.blockedBy ? 'red' : undefined),
		},
		{
			id: 'head',
			title: 'Head',
			width: 4,
			align: 'right',
			priority: 3,
			value: r => (r.headBlocker ? 1 : null),
			text: r => (r.headBlocker ? '1' : ''),
			color: r => (r.headBlocker ? 'red' : undefined),
		},
		{id: 'cpu', title: 'CPU ms', width: 11, align: 'right', priority: 5, value: r => r.cpuMs, text: r => int(r.cpuMs)},
		{id: 'io', title: 'Phys I/O', width: 11, align: 'right', priority: 8, value: r => r.physicalIo, text: r => int(r.physicalIo)},
		{id: 'mem', title: 'Mem KB', width: 8, align: 'right', priority: 4, value: r => r.memoryKb, text: r => int(r.memoryKb)},
		{id: 'tran', title: 'Tran', width: 4, align: 'right', priority: 8, value: r => r.openTran, text: r => (r.openTran ? String(r.openTran) : '')},
		{id: 'host', title: 'Host', width: 10, flex: 1, priority: 3, value: r => r.host},
		{id: 'group', title: 'Workload', width: 8, priority: 9, value: r => r.workloadGroup},
	];
	if (grouped) {
		cols.splice(5, 0, {
			id: 'tasks',
			title: 'Tasks',
			width: 5,
			align: 'right',
			priority: 4,
			value: r => r.tasks,
			text: r => (r.tasks ? String(r.tasks) : ''),
		});
	}
	return cols;
}

export const recentColumns: Column<RecentQueryRow>[] = [
	{id: 'query', title: 'Query', width: 30, flex: 1, priority: 0, value: r => oneLine(r.text)},
	{id: 'execs', title: 'Exec/min', width: 9, align: 'right', priority: 1, value: r => r.execPerMin, text: r => fmtRate(r.execPerMin)},
	{id: 'cpu', title: 'CPU ms/s', width: 9, align: 'right', priority: 0, value: r => r.cpuMsPerSec, text: r => fmtRate(r.cpuMsPerSec)},
	{id: 'preads', title: 'PhysRd/s', width: 9, align: 'right', priority: 3, value: r => r.physicalReadsPerSec, text: r => fmtRate(r.physicalReadsPerSec)},
	{id: 'lwrites', title: 'LogWr/s', width: 9, align: 'right', priority: 3, value: r => r.logicalWritesPerSec, text: r => fmtRate(r.logicalWritesPerSec)},
	{id: 'lreads', title: 'LogRd/s', width: 10, align: 'right', priority: 2, value: r => r.logicalReadsPerSec, text: r => fmtRate(r.logicalReadsPerSec)},
	{id: 'avgdur', title: 'Avg ms', width: 9, align: 'right', priority: 1, value: r => r.avgDurationMs, text: r => fmtRate(r.avgDurationMs)},
	{id: 'plans', title: 'Plans', width: 5, align: 'right', priority: 4, value: r => r.planCount},
	{id: 'database', title: 'Database', width: 14, priority: 2, value: r => r.database},
];

export const activeColumns: Column<ActiveQueryRow>[] = [
	{id: 'query', title: 'Query', width: 30, flex: 1, priority: 0, value: r => oneLine(r.text)},
	{id: 'spid', title: 'SPID', width: 5, align: 'right', priority: 0, value: r => r.sessionId},
	{id: 'cpu', title: 'CPU ms', width: 10, align: 'right', priority: 1, value: r => r.cpuMs, text: r => fmtInt(r.cpuMs)},
	{id: 'cpurate', title: 'CPU ms/s', width: 9, align: 'right', priority: 2, value: r => r.cpuMsPerSec, text: r => fmtRate(r.cpuMsPerSec)},
	{id: 'database', title: 'Database', width: 12, priority: 1, value: r => r.database},
	{id: 'elapsed', title: 'Elapsed ms', width: 11, align: 'right', priority: 1, value: r => r.elapsedMs, text: r => fmtInt(r.elapsedMs)},
	{id: 'preads', title: 'Phys Rd', width: 9, align: 'right', priority: 4, value: r => r.physicalReads, text: r => fmtInt(r.physicalReads)},
	{id: 'writes', title: 'Writes', width: 9, align: 'right', priority: 3, value: r => r.writes, text: r => fmtInt(r.writes)},
	{id: 'lreads', title: 'Logical Rd', width: 12, align: 'right', priority: 2, value: r => r.logicalReads, text: r => fmtInt(r.logicalReads)},
	{id: 'rows', title: 'Rows', width: 9, align: 'right', priority: 5, value: r => r.rowCount, text: r => fmtInt(r.rowCount)},
	{id: 'granted', title: 'Alloc KB', width: 9, align: 'right', priority: 4, value: r => r.grantedKb, text: r => int(r.grantedKb)},
	{id: 'used', title: 'Used KB', width: 8, align: 'right', priority: 4, value: r => r.usedKb, text: r => int(r.usedKb)},
	{id: 'required', title: 'Req KB', width: 7, align: 'right', priority: 6, value: r => r.requiredKb, text: r => int(r.requiredKb)},
	{id: 'waittype', title: 'Wait Type', width: 13, priority: 3, value: r => r.waitType, color: r => (r.waitType ? 'yellow' : undefined)},
	{
		id: 'blockedby',
		title: 'Blk By',
		width: 6,
		align: 'right',
		priority: 3,
		value: r => r.blockedBy,
		color: r => (r.blockedBy ? 'red' : undefined),
	},
];
