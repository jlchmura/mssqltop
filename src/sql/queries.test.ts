import {describe, expect, it} from 'vitest';
import {
	ACTIVE_QUERIES,
	MARKER,
	NEXT_SINCE,
	OVERVIEW,
	PROCESSES,
	SERVER_INFO,
	activePlan,
	livePlan,
	recentPlan,
	recentQueries,
	sessionDetail,
} from './queries.js';

const SINCE = '2026-09-27 08:10:08.217';

describe('recentQueries', () => {
	it('returns every query without text or filtering for the baseline', () => {
		const sql = recentQueries(null);
		expect(sql).not.toContain('HAVING');
		expect(sql).not.toContain('statement_text');
	});

	it('filters to queries that finished since the watermark and includes their text', () => {
		const sql = recentQueries(SINCE);
		expect(sql).toContain(`>= '${SINCE}'`);
		expect(sql).toContain('statement_text');
	});

	it.each(["2026-01-01'; DROP TABLE t;--", '2026-01-01', 'yesterday', ''])(
		'rejects a non-datetime watermark: %j',
		since => {
			expect(() => recentQueries(since)).toThrow(/Bad datetime/);
		},
	);
});

describe('sessionDetail', () => {
	it('queries the given session, with or without the input buffer', () => {
		expect(sessionDetail(52, true)).toContain('dm_exec_input_buffer(52, NULL)');
		expect(sessionDetail(52, true)).toContain('session_id = 52');
		expect(sessionDetail(52, false)).not.toContain('dm_exec_input_buffer');
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects a session id of %s', id => {
		expect(() => sessionDetail(id, true)).toThrow(/Bad session id/);
	});
});

describe('plan queries', () => {
	it('fetch a request’s live and cached plans', () => {
		expect(livePlan(52, 0)).toContain('dm_exec_query_statistics_xml(52)');
		expect(livePlan(52, 0)).toContain('request_id = 0');
		expect(activePlan(52, 3)).toContain('r.session_id = 52 AND r.request_id = 3');
	});

	it('look up a recent query’s plan by query hash or by statement handle', () => {
		expect(recentPlan('0x1234567890ABCDEF')).toContain('WHERE query_hash = 0x1234567890ABCDEF');
		expect(recentPlan('0x0200ABCD:120')).toContain('sql_handle = 0x0200ABCD AND statement_start_offset = 120');
	});

	it.each(["0x1'; DROP TABLE x --", '0x12', 'abc:1', '0x0200:-1', ''])('rejects the key %j', key => {
		expect(() => recentPlan(key)).toThrow(/Bad query key/);
	});

	it('rejects bad ids', () => {
		expect(() => livePlan(0, 0)).toThrow(/Bad session id/);
		expect(() => activePlan(1, -1)).toThrow(/Bad request id/);
		expect(() => activePlan(1, 1.5)).toThrow(/Bad request id/);
	});
});

describe('every statement', () => {
	const statements = {
		SERVER_INFO,
		OVERVIEW,
		PROCESSES,
		ACTIVE_QUERIES,
		NEXT_SINCE,
		recentBaseline: recentQueries(null),
		recent: recentQueries(SINCE),
		sessionDetail: sessionDetail(52, true),
		livePlan: livePlan(52, 0),
		activePlan: activePlan(52, 0),
		recentPlan: recentPlan('0x1234567890ABCDEF'),
	};

	it.each(Object.entries(statements))('%s carries the marker so the monitor can hide its own queries', (_, sql) => {
		expect(sql).toContain(MARKER);
	});

	it.each(Object.entries(statements))('%s is a single statement (odbc only returns the first result set)', (_, sql) => {
		const code = sql
			.replace(/--.*$/gm, '')
			.replace(/\/\*.*?\*\//gs, '')
			.replace(/'[^']*'/g, "''");
		expect(code.trim().replace(/;$/, '')).not.toContain(';');
	});
});

describe('ODBC column ordering', () => {
	// The SQL Server ODBC driver fails with "Invalid Descriptor Index" if a (max) column precedes others.
	it('selects statement_text last in the active queries', () => {
		expect(ACTIVE_QUERIES).toMatch(/AS statement_text\s+FROM sys\.dm_exec_requests/);
	});

	it('selects statement_text last in the recent queries', () => {
		expect(recentQueries(SINCE)).toMatch(/, t\.statement_text\s+FROM agg a/);
	});
});
