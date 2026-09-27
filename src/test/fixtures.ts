/** Builders for test data; override only the fields a test cares about. */
import type {ActiveQueryRow, MonitorState, ProcessRow, RecentQueryRow} from '../monitor/types.js';
import {emptySeries} from '../monitor/series.js';

export function processRow(overrides: Partial<ProcessRow> = {}): ProcessRow {
	const sessionId = overrides.sessionId ?? 55;
	return {
		key: `${sessionId}:0:0:0`,
		sessionId,
		userProcess: true,
		login: 'CORP\\alice',
		database: 'Sales',
		taskState: 'RUNNING',
		command: 'SELECT',
		application: 'App',
		waitTimeMs: null,
		waitType: '',
		waitResource: '',
		blockedBy: null,
		headBlocker: false,
		memoryKb: 24,
		host: 'WEB01',
		workloadGroup: 'default',
		cpuMs: 100,
		physicalIo: 0,
		logicalReads: 0,
		openTran: 0,
		netAddress: '10.0.0.1',
		loginTime: '2026-01-01 00:00:00',
		lastRequestStart: '2026-01-01 00:00:00',
		sessionStatus: 'running',
		requestId: 0,
		execContextId: 0,
		tasks: 1,
		...overrides,
	};
}

export function activeRow(overrides: Partial<ActiveQueryRow> = {}): ActiveQueryRow {
	return {
		key: '55:0:2026-01-01 00:00:00.000',
		sessionId: 55,
		requestId: 0,
		startTime: '2026-01-01 00:00:00.000',
		database: 'Sales',
		status: 'running',
		command: 'SELECT',
		cpuMs: 1000,
		cpuMsPerSec: null,
		elapsedMs: 2000,
		physicalReads: 0,
		writes: 0,
		logicalReads: 500,
		rowCount: 0,
		waitType: '',
		waitTimeMs: 0,
		blockedBy: null,
		dop: null,
		queryCost: null,
		requestedKb: null,
		grantedKb: null,
		usedKb: null,
		maxUsedKb: null,
		requiredKb: null,
		idealKb: null,
		login: 'CORP\\alice',
		host: 'WEB01',
		application: 'App',
		queryHash: '0x1234567890ABCDEF',
		text: 'SELECT * FROM dbo.Orders',
		...overrides,
	};
}

export function recentRow(overrides: Partial<RecentQueryRow> = {}): RecentQueryRow {
	return {
		key: '0x1234567890ABCDEF',
		text: 'SELECT * FROM dbo.Orders WHERE id = @id',
		database: 'Sales',
		executions: 10,
		execPerMin: 10,
		cpuMsPerSec: 5,
		physicalReadsPerSec: 0,
		logicalWritesPerSec: 0,
		logicalReadsPerSec: 100,
		avgDurationMs: 30,
		avgCpuMs: 30,
		planCount: 1,
		...overrides,
	};
}

export function monitorState(overrides: Partial<MonitorState> = {}): MonitorState {
	return {
		server: null,
		series: emptySeries(),
		processes: [],
		active: [],
		recent: [],
		recentWindowSec: 0,
		recentReady: false,
		lastUpdate: null,
		fastQueryMs: null,
		error: null,
		recentError: null,
		paused: false,
		intervalMs: 2000,
		...overrides,
	};
}
