/** Data shapes the monitor publishes to the UI. */

export interface ServerInfo {
	name: string;
	productVersion: string;
	productLevel: string;
	edition: string;
	cpuCount: number;
	memoryKb: number;
	/** When the SQL Server service started, in local epoch ms. */
	startedAt: number;
}

/** One row of the Processes grid: a task, or (after {@link groupBySession}) a whole session. */
export interface ProcessRow {
	key: string;
	sessionId: number;
	userProcess: boolean;
	login: string;
	database: string;
	taskState: string;
	command: string;
	application: string;
	waitTimeMs: number | null;
	waitType: string;
	waitResource: string;
	blockedBy: number | null;
	headBlocker: boolean;
	memoryKb: number;
	host: string;
	workloadGroup: string;
	cpuMs: number;
	physicalIo: number;
	logicalReads: number;
	openTran: number;
	netAddress: string;
	loginTime: string;
	lastRequestStart: string;
	sessionStatus: string;
	requestId: number | null;
	execContextId: number | null;
	/** Number of tasks folded into this row (1 unless grouped by session). */
	tasks: number;
}

/** One row of the Active Expensive Queries grid: a request executing right now. */
export interface ActiveQueryRow {
	key: string;
	sessionId: number;
	requestId: number;
	startTime: string;
	database: string;
	status: string;
	command: string;
	cpuMs: number;
	/** CPU used since the previous refresh; null on the first sighting. */
	cpuMsPerSec: number | null;
	elapsedMs: number;
	physicalReads: number;
	writes: number;
	logicalReads: number;
	rowCount: number;
	waitType: string;
	waitTimeMs: number;
	blockedBy: number | null;
	dop: number | null;
	queryCost: number | null;
	requestedKb: number | null;
	grantedKb: number | null;
	usedKb: number | null;
	maxUsedKb: number | null;
	requiredKb: number | null;
	idealKb: number | null;
	login: string;
	host: string;
	application: string;
	queryHash: string;
	text: string;
}

/** One row of the Recent Expensive Queries grid: a query shape's activity over the rolling window. */
export interface RecentQueryRow {
	/** query_hash as hex, or sql_handle:offset for statements without a hash. */
	key: string;
	text: string;
	database: string;
	executions: number;
	execPerMin: number;
	cpuMsPerSec: number;
	physicalReadsPerSec: number;
	logicalWritesPerSec: number;
	logicalReadsPerSec: number;
	avgDurationMs: number;
	avgCpuMs: number;
	planCount: number;
}

/** Chart history, oldest first. */
export interface Series {
	/** SQL Server process CPU, 0–100. */
	cpu: number[];
	waiting: number[];
	/** MB/s. */
	io: number[];
	/** Batches/s. */
	batch: number[];
}

export interface SessionDetail {
	currentStatement: string | null;
	lastBatch: string | null;
	inputBuffer: string | null;
}

/** `live`: in-flight plan with actual rows so far; `estimated`: the cached plan. */
export type PlanSource = 'live' | 'estimated';

export interface FetchedPlan {
	source: PlanSource;
	/** Showplan XML, as SSMS saves it in a .sqlplan file. */
	xml: string;
}

/** Whose plan to fetch: a running request, or a Recent Expensive Queries row by its key. */
export type PlanTarget = {kind: 'active'; sessionId: number; requestId: number} | {kind: 'recent'; key: string};

export interface MonitorState {
	server: ServerInfo | null;
	series: Series;
	processes: ProcessRow[];
	active: ActiveQueryRow[];
	recent: RecentQueryRow[];
	/** Seconds of history the recent-query rates currently cover. */
	recentWindowSec: number;
	/** False until the first delta after the plan-cache baseline. */
	recentReady: boolean;
	lastUpdate: number | null;
	/** How long the last refresh's queries took. */
	fastQueryMs: number | null;
	error: string | null;
	recentError: string | null;
	paused: boolean;
	intervalMs: number;
}
