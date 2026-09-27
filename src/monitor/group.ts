import type {ProcessRow} from './types.js';

const TASK_STATE_RANK: Record<string, number> = {RUNNING: 5, RUNNABLE: 4, SUSPENDED: 3, SPINLOOP: 2, PENDING: 1};
const rank = (state: string) => TASK_STATE_RANK[state] ?? 0;

/**
 * Folds the per-task rows SSMS shows (one per parallel worker) into one row per session.
 * Each session keeps its most interesting task's state and wait: a blocked task beats an
 * unblocked one, then the busier state, then the longer wait.
 */
export function groupBySession(rows: readonly ProcessRow[]): ProcessRow[] {
	const bySession = new Map<number, ProcessRow>();
	for (const task of rows) {
		// Parallel workers waiting on each other report their own session as the blocker.
		const row = task.blockedBy === task.sessionId ? {...task, blockedBy: null} : task;
		const cur = bySession.get(row.sessionId);
		if (!cur) {
			bySession.set(row.sessionId, {...row, key: String(row.sessionId), tasks: row.taskState ? 1 : 0});
			continue;
		}
		if (row.taskState) cur.tasks++;
		cur.headBlocker ||= row.headBlocker;
		if (isMoreInteresting(row, cur)) {
			cur.taskState = row.taskState;
			cur.waitTimeMs = row.waitTimeMs;
			cur.waitType = row.waitType;
			cur.waitResource = row.waitResource;
			cur.blockedBy = row.blockedBy;
		}
	}
	return [...bySession.values()];
}

function isMoreInteresting(task: ProcessRow, than: ProcessRow): boolean {
	if ((task.blockedBy !== null) !== (than.blockedBy !== null)) return task.blockedBy !== null;
	if (rank(task.taskState) !== rank(than.taskState)) return rank(task.taskState) > rank(than.taskState);
	return (task.waitTimeMs ?? 0) > (than.waitTimeMs ?? 0);
}
