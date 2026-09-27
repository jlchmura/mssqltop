/** Maps raw DMV rows (see src/sql/queries.ts) onto the monitor's row types. */
import type {Row} from '../db/values.js';
import type {ActiveQueryRow, ProcessRow, ServerInfo} from './types.js';

export const str = (v: unknown): string => (v == null ? '' : String(v));
export const num = (v: unknown): number => (v == null ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function toServerInfo(r: Row, now: number): ServerInfo {
	return {
		name: str(r.server_name),
		productVersion: str(r.product_version),
		productLevel: str(r.product_level),
		edition: str(r.edition),
		cpuCount: num(r.cpu_count),
		memoryKb: num(r.physical_memory_kb),
		startedAt: now - num(r.uptime_s) * 1000,
	};
}

/** `index` disambiguates tasks that share a session/request/context id. */
export function toProcessRow(r: Row, index: number): ProcessRow {
	return {
		key: `${str(r.session_id)}:${str(r.request_id)}:${str(r.exec_context_id)}:${index}`,
		sessionId: num(r.session_id),
		userProcess: r.is_user_process === 1,
		login: str(r.login_name),
		database: str(r.database_name),
		taskState: str(r.task_state),
		command: str(r.command),
		application: str(r.program_name),
		waitTimeMs: numOrNull(r.wait_duration_ms),
		waitType: str(r.wait_type),
		waitResource: str(r.wait_resource),
		blockedBy: numOrNull(r.blocked_by),
		headBlocker: Boolean(r.head_blocker),
		memoryKb: num(r.memory_kb),
		host: str(r.host_name),
		workloadGroup: str(r.workload_group),
		cpuMs: num(r.cpu_time),
		physicalIo: num(r.physical_io),
		logicalReads: num(r.logical_reads),
		openTran: num(r.open_tran),
		netAddress: str(r.client_net_address),
		loginTime: str(r.login_time),
		lastRequestStart: str(r.last_request_start),
		sessionStatus: str(r.session_status),
		requestId: numOrNull(r.request_id),
		execContextId: numOrNull(r.exec_context_id),
		tasks: 1,
	};
}

/** A request is identified by session, request id and start time (ids are reused). */
export const activeKey = (r: Row): string => `${str(r.session_id)}:${str(r.request_id)}:${str(r.start_time)}`;

export function toActiveRow(r: Row, cpuMsPerSec: number | null): ActiveQueryRow {
	return {
		key: activeKey(r),
		sessionId: num(r.session_id),
		requestId: num(r.request_id),
		startTime: str(r.start_time),
		database: str(r.database_name),
		status: str(r.status),
		command: str(r.command),
		cpuMs: num(r.cpu_time),
		cpuMsPerSec,
		elapsedMs: num(r.total_elapsed_time),
		physicalReads: num(r.physical_reads),
		writes: num(r.writes),
		logicalReads: num(r.logical_reads),
		rowCount: num(r.row_count),
		waitType: str(r.wait_type),
		waitTimeMs: num(r.wait_time),
		blockedBy: numOrNull(r.blocked_by),
		dop: numOrNull(r.dop),
		queryCost: numOrNull(r.query_cost),
		requestedKb: numOrNull(r.requested_memory_kb),
		grantedKb: numOrNull(r.granted_memory_kb),
		usedKb: numOrNull(r.used_memory_kb),
		maxUsedKb: numOrNull(r.max_used_memory_kb),
		requiredKb: numOrNull(r.required_memory_kb),
		idealKb: numOrNull(r.ideal_memory_kb),
		login: str(r.login_name),
		host: str(r.host_name),
		application: str(r.program_name),
		queryHash: str(r.query_hash),
		text: str(r.statement_text),
	};
}

/** Turns a cumulative per-key counter into a per-second rate between consecutive samples. */
export class RateTracker {
	private prev = new Map<string, {value: number; at: number}>();

	/** Returns each key's rate since the last call (null if unseen then) and forgets keys not present now. */
	next(samples: Iterable<readonly [key: string, value: number]>, now: number): Map<string, number | null> {
		const rates = new Map<string, number | null>();
		const seen = new Map<string, {value: number; at: number}>();
		for (const [key, value] of samples) {
			const prev = this.prev.get(key);
			rates.set(key, prev && now > prev.at ? Math.max(0, (value - prev.value) / ((now - prev.at) / 1000)) : null);
			seen.set(key, {value, at: now});
		}
		this.prev = seen;
		return rates;
	}
}
