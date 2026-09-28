/**
 * All T-SQL the monitor runs, modeled on the queries SSMS Activity Monitor issues.
 *
 * Column names here are a contract with the row mappers in src/monitor/rows.ts.
 * Each export is a single statement, because the ODBC binding only returns the first result set.
 */

/** Embedded in every statement we run so our own work can be left out of the query lists. */
export const MARKER = '/*mssqltop*/';

export const SERVER_INFO = `
SELECT ${MARKER}
	@@SERVERNAME AS server_name,
	CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS product_version,
	CONVERT(nvarchar(128), SERVERPROPERTY('ProductLevel')) AS product_level,
	CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS edition,
	i.cpu_count,
	i.physical_memory_kb,
	DATEDIFF(second, i.sqlserver_start_time, GETDATE()) AS uptime_s
FROM sys.dm_os_sys_info i;
`;

/** Cumulative counters; the monitor turns consecutive samples into rates. */
export const OVERVIEW = `
SELECT ${MARKER}
	(SELECT ms_ticks FROM sys.dm_os_sys_info) AS ms_ticks,
	(SELECT cpu_count FROM sys.dm_os_sys_info) AS cpu_count,
	(SELECT SUM(CONVERT(bigint, kernel_time) + CONVERT(bigint, usermode_time)) FROM sys.dm_os_threads) AS cpu_ms,
	(SELECT COUNT(*) FROM sys.dm_os_waiting_tasks wt
		JOIN sys.dm_exec_sessions s ON s.session_id = wt.session_id
		WHERE s.is_user_process = 1 AND wt.session_id <> @@SPID) AS waiting_tasks,
	(SELECT SUM(num_of_bytes_read + num_of_bytes_written) FROM sys.dm_io_virtual_file_stats(NULL, NULL)) AS io_bytes,
	(SELECT TOP 1 cntr_value FROM sys.dm_os_performance_counters
		WHERE counter_name = 'Batch Requests/sec' AND object_name LIKE '%SQL Statistics%') AS batch_requests;
`;

/** One row per task, like SSMS; sessions without a request get a single row with no task. */
export const PROCESSES = `
SELECT ${MARKER}
	s.session_id,
	s.is_user_process,
	s.login_name,
	DB_NAME(s.database_id) AS database_name,
	t.task_state,
	r.command,
	s.program_name,
	w.wait_duration_ms,
	w.wait_type,
	w.resource_description AS wait_resource,
	NULLIF(COALESCE(w.blocking_session_id, r.blocking_session_id), 0) AS blocked_by,
	CASE WHEN b.blocking_session_id IS NOT NULL AND ISNULL(r.blocking_session_id, 0) = 0 THEN 1 ELSE 0 END AS head_blocker,
	s.memory_usage * 8 AS memory_kb,
	s.host_name,
	g.name AS workload_group,
	-- Session totals only include completed requests, so add the one in flight.
	s.cpu_time + ISNULL(r.cpu_time, 0) AS cpu_time,
	s.reads + s.writes + ISNULL(r.reads + r.writes, 0) AS physical_io,
	s.logical_reads + ISNULL(r.logical_reads, 0) AS logical_reads,
	ISNULL(r.open_transaction_count, s.open_transaction_count) AS open_tran,
	c.client_net_address,
	CONVERT(varchar(19), s.login_time, 120) AS login_time,
	CONVERT(varchar(19), s.last_request_start_time, 120) AS last_request_start,
	s.status AS session_status,
	r.request_id,
	t.exec_context_id
FROM sys.dm_exec_sessions s
OUTER APPLY (
	SELECT TOP 1 client_net_address FROM sys.dm_exec_connections ec
	WHERE ec.session_id = s.session_id ORDER BY ec.connect_time
) c
LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
LEFT JOIN sys.dm_os_tasks t ON t.session_id = r.session_id AND t.request_id = r.request_id
LEFT JOIN (
	SELECT waiting_task_address, wait_duration_ms, wait_type, resource_description, blocking_session_id,
		ROW_NUMBER() OVER (PARTITION BY waiting_task_address ORDER BY wait_duration_ms DESC) AS rn
	FROM sys.dm_os_waiting_tasks
) w ON w.waiting_task_address = t.task_address AND w.rn = 1
LEFT JOIN (
	SELECT DISTINCT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0
) b ON b.blocking_session_id = s.session_id
LEFT JOIN sys.dm_resource_governor_workload_groups g ON g.group_id = s.group_id
WHERE s.session_id <> @@SPID;
`;

// The ODBC driver requires (max) columns to come after all other columns in a result set,
// so keep this last in every SELECT list.
const STATEMENT_TEXT = (textCol: string, startCol: string, endCol: string) => `
LEFT(SUBSTRING(${textCol}, ${startCol} / 2 + 1,
	(CASE WHEN ${endCol} = -1 THEN DATALENGTH(${textCol}) ELSE ${endCol} END - ${startCol}) / 2 + 1), 8000)`;

export const ACTIVE_QUERIES = `
SELECT ${MARKER}
	r.session_id,
	r.request_id,
	CONVERT(varchar(23), r.start_time, 121) AS start_time,
	DB_NAME(r.database_id) AS database_name,
	r.status,
	r.command,
	r.cpu_time,
	r.total_elapsed_time,
	r.reads AS physical_reads,
	r.writes,
	r.logical_reads,
	r.row_count,
	r.wait_type,
	r.wait_time,
	NULLIF(r.blocking_session_id, 0) AS blocked_by,
	mg.dop,
	mg.query_cost,
	mg.requested_memory_kb,
	mg.granted_memory_kb,
	mg.used_memory_kb,
	mg.max_used_memory_kb,
	mg.required_memory_kb,
	mg.ideal_memory_kb,
	s.login_name,
	s.host_name,
	s.program_name,
	CONVERT(varchar(18), r.query_hash, 1) AS query_hash,
	${STATEMENT_TEXT('st.text', 'r.statement_start_offset', 'r.statement_end_offset')} AS statement_text
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_query_memory_grants mg ON mg.session_id = r.session_id AND mg.request_id = r.request_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE s.is_user_process = 1 AND r.session_id <> @@SPID AND r.sql_handle IS NOT NULL;
`;

const DATETIME_LITERAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/** The server's clock less some slack, used as the next {@link recentQueries} `since`. */
export const NEXT_SINCE = `SELECT ${MARKER} CONVERT(varchar(23), DATEADD(second, -2, GETDATE()), 121) AS next_since;`;

/**
 * Cumulative dm_exec_query_stats totals aggregated by query_hash. Only queries that
 * finished an execution at/after `since` (a server-local datetime string) are returned,
 * which keeps each poll small; the first poll (since = null) returns everything as a baseline.
 * Callers take NEXT_SINCE just before each scan and pass it to the following one; overlapping
 * windows are harmless because callers diff against the totals they last saw.
 */
export function recentQueries(since: string | null): string {
	if (since !== null && !DATETIME_LITERAL.test(since)) throw new Error(`Bad datetime: ${since}`);
	const includeDetail = since !== null;
	return `
WITH keyed AS (
	SELECT ${MARKER}
		-- query_hash is 0 for cursor fetches and some internal statements; don't lump those together
		CASE WHEN query_hash = 0x0000000000000000
			THEN CONVERT(varchar(130), sql_handle, 1) + ':' + CONVERT(varchar(11), statement_start_offset)
			ELSE CONVERT(varchar(18), query_hash, 1) END AS query_key,
		execution_count, total_worker_time, total_physical_reads, total_logical_writes,
		total_logical_reads, total_elapsed_time, plan_handle, sql_handle, statement_start_offset,
		statement_end_offset, last_execution_time, last_elapsed_time
	FROM sys.dm_exec_query_stats
), qs AS (
	SELECT *, ROW_NUMBER() OVER (PARTITION BY query_key ORDER BY last_execution_time DESC) AS rn
	FROM keyed
), agg AS (
	SELECT
		query_key,
		SUM(execution_count) AS executions,
		SUM(total_worker_time) AS worker_us,
		SUM(total_physical_reads) AS physical_reads,
		SUM(total_logical_writes) AS logical_writes,
		SUM(total_logical_reads) AS logical_reads,
		SUM(total_elapsed_time) AS elapsed_us,
		COUNT(DISTINCT plan_handle) AS plan_count,
		MAX(CASE WHEN rn = 1 THEN plan_handle END) AS plan_handle,
		MAX(CASE WHEN rn = 1 THEN sql_handle END) AS sql_handle,
		MAX(CASE WHEN rn = 1 THEN statement_start_offset END) AS stmt_start,
		MAX(CASE WHEN rn = 1 THEN statement_end_offset END) AS stmt_end
	FROM qs
	GROUP BY query_key
	${includeDetail ? `HAVING MAX(DATEADD(millisecond, last_elapsed_time / 1000, last_execution_time)) >= '${since}'` : ''}
)
SELECT
	a.query_key,
	a.executions, a.worker_us, a.physical_reads, a.logical_writes, a.logical_reads, a.elapsed_us, a.plan_count
	${includeDetail ? ', d.database_name, t.statement_text' : ''}
FROM agg a
${
	includeDetail
		? `
OUTER APPLY (
	SELECT ${STATEMENT_TEXT('st.text', 'a.stmt_start', 'a.stmt_end')} AS statement_text
	FROM sys.dm_exec_sql_text(a.sql_handle) st
) t
OUTER APPLY (
	SELECT DB_NAME(CONVERT(int, pa.value)) AS database_name
	FROM sys.dm_exec_plan_attributes(a.plan_handle) pa WHERE pa.attribute = 'dbid'
) d`
		: ''
};
`;
}

const checkIds = (sessionId: number, requestId: number) => {
	if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error(`Bad session id: ${sessionId}`);
	if (!Number.isInteger(requestId) || requestId < 0) throw new Error(`Bad request id: ${requestId}`);
};

/**
 * A running request's plan with the actual row counts so far. Needs SQL Server 2016 SP1 or later
 * with lightweight query profiling (on by default from 2019; trace flag 7412 before that); returns
 * no rows otherwise.
 */
export function livePlan(sessionId: number, requestId: number): string {
	checkIds(sessionId, requestId);
	return `
SELECT ${MARKER} CONVERT(nvarchar(max), x.query_plan) AS query_plan
FROM sys.dm_exec_query_statistics_xml(${sessionId}) x
WHERE x.request_id = ${requestId};
`;
}

/** The cached (estimated) plan of the statement a request is running. */
export function activePlan(sessionId: number, requestId: number): string {
	checkIds(sessionId, requestId);
	return `
SELECT ${MARKER} p.query_plan
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_text_query_plan(r.plan_handle, r.statement_start_offset, r.statement_end_offset) p
WHERE r.session_id = ${sessionId} AND r.request_id = ${requestId};
`;
}

const QUERY_HASH_KEY = /^0x[0-9A-F]{16}$/i;
const HANDLE_KEY = /^(0x[0-9A-F]{2,128}):(\d{1,10})$/i;

/** The cached plan most recently used by a Recent Expensive Queries row (keyed as in {@link recentQueries}). */
export function recentPlan(key: string): string {
	const handle = HANDLE_KEY.exec(key);
	let where: string;
	if (QUERY_HASH_KEY.test(key)) where = `query_hash = ${key}`;
	else if (handle) where = `sql_handle = ${handle[1]} AND statement_start_offset = ${handle[2]}`;
	else throw new Error(`Bad query key: ${key}`);
	return `
WITH qs AS (
	SELECT TOP 1 plan_handle, statement_start_offset, statement_end_offset
	FROM sys.dm_exec_query_stats
	WHERE ${where}
	ORDER BY last_execution_time DESC
)
SELECT ${MARKER} p.query_plan
FROM qs
CROSS APPLY sys.dm_exec_text_query_plan(qs.plan_handle, qs.statement_start_offset, qs.statement_end_offset) p;
`;
}

/**
 * The SQL text behind one session: its current statement, most recent batch and (when supported)
 * input buffer. sys.dm_exec_input_buffer needs SQL Server 2014 SP2 / 2016 SP1 or later.
 */
export function sessionDetail(sessionId: number, withInputBuffer: boolean): string {
	if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error(`Bad session id: ${sessionId}`);
	const id = sessionId;
	return `
SELECT ${MARKER}
	(SELECT TOP 1 ${STATEMENT_TEXT('st.text', 'r.statement_start_offset', 'r.statement_end_offset')}
		FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
		WHERE r.session_id = ${id}) AS current_statement,
	(SELECT TOP 1 LEFT(st.text, 16000)
		FROM sys.dm_exec_connections c CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) st
		WHERE c.session_id = ${id}) AS last_batch
	${withInputBuffer ? `, (SELECT TOP 1 LEFT(event_info, 16000) FROM sys.dm_exec_input_buffer(${id}, NULL)) AS input_buffer` : ''};
`;
}
