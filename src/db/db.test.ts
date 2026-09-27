import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('odbc', () => ({default: {connect: vi.fn()}}));
const odbc = (await import('odbc')).default;
const {Db} = await import('./db.js');

type Handler = (sql: string) => unknown[] | Promise<unknown[]>;

/** A fake odbc.Connection whose query results come from `handler`. */
function fakeConnection(handler: Handler = () => []) {
	const connection = {
		query: vi.fn(async (sql: string) => {
			if (sql.includes('@@SPID')) return withColumns([{spid: 61}]);
			if (sql.includes('SET NOCOUNT')) return withColumns([]);
			return withColumns(await handler(sql));
		}),
		close: vi.fn(async () => {}),
	};
	vi.mocked(odbc.connect).mockResolvedValueOnce(connection as never);
	return connection;
}

function withColumns(rows: unknown[], columns: Array<{name: string; dataType: number}> = []) {
	return Object.assign([...rows], {columns});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => (resolve = r));
	return {promise, resolve};
}

const connectionLost = Object.assign(new Error('[odbc] Error'), {
	odbcErrors: [{state: '08S01', message: 'Communication link failure'}],
});

beforeEach(() => vi.mocked(odbc.connect).mockReset());

describe('Db', () => {
	it('connects lazily with a login timeout and initializes the session', async () => {
		const conn = fakeConnection(() => [{x: 1}]);
		const db = new Db('DSN=test;', {loginTimeoutSec: 7});
		expect(odbc.connect).not.toHaveBeenCalled();

		expect(await db.query('SELECT 1 AS x')).toEqual([{x: 1}]);
		expect(odbc.connect).toHaveBeenCalledWith({connectionString: 'DSN=test;', loginTimeout: 7});
		expect(conn.query.mock.calls[0]![0]).toContain('READ UNCOMMITTED');
		expect(db.spid).toBe(61);
	});

	it('reuses one connection, even for concurrent first queries', async () => {
		fakeConnection();
		const db = new Db('DSN=test;');
		await Promise.all([db.query('a'), db.query('b'), db.query('c')]);
		expect(odbc.connect).toHaveBeenCalledTimes(1);
	});

	it('passes the query timeout to the driver', async () => {
		const conn = fakeConnection();
		await new Db('DSN=test;', {queryTimeoutSec: 99}).query('SELECT 1');
		expect(conn.query).toHaveBeenLastCalledWith('SELECT 1', {timeout: 99});
	});

	it('normalizes BIT columns by type and BIGINTs by value', async () => {
		const conn = fakeConnection();
		conn.query.mockResolvedValueOnce(withColumns([]));
		conn.query.mockResolvedValueOnce(withColumns([{spid: 61}]));
		conn.query.mockResolvedValueOnce(
			withColumns(
				[{flag: '1', big: 12n, name: '1'}],
				[
					{name: 'flag', dataType: -7},
					{name: 'big', dataType: -5},
					{name: 'name', dataType: 12},
				],
			),
		);
		expect(await new Db('DSN=test;').query('x')).toEqual([{flag: 1, big: 12, name: '1'}]);
	});

	it('runs one query at a time', async () => {
		const first = deferred<unknown[]>();
		const started: string[] = [];
		fakeConnection(sql => {
			started.push(sql);
			return sql === 'first' ? first.promise : [];
		});
		const db = new Db('DSN=test;');
		const a = db.query('first');
		const b = db.query('second');
		await vi.waitFor(() => expect(started).toEqual(['first']));
		first.resolve([]);
		await Promise.all([a, b]);
		expect(started).toEqual(['first', 'second']);
	});

	it('keeps running queries after one fails', async () => {
		fakeConnection(sql => {
			if (sql === 'bad') throw new Error('syntax');
			return [{ok: 1}];
		});
		const db = new Db('DSN=test;');
		await expect(db.query('bad')).rejects.toThrow('syntax');
		expect(await db.query('good')).toEqual([{ok: 1}]);
	});

	it('reconnects after a connection-level error', async () => {
		const broken = fakeConnection(() => {
			throw connectionLost;
		});
		fakeConnection(() => [{ok: 1}]);
		const db = new Db('DSN=test;');

		await expect(db.query('x')).rejects.toBe(connectionLost);
		expect(broken.close).toHaveBeenCalled();
		expect(await db.query('x')).toEqual([{ok: 1}]);
		expect(odbc.connect).toHaveBeenCalledTimes(2);
	});

	it('keeps the connection after an ordinary SQL error', async () => {
		const conn = fakeConnection(() => {
			throw Object.assign(new Error('[odbc]'), {odbcErrors: [{state: '42S02', message: 'Invalid object name'}]});
		});
		const db = new Db('DSN=test;');
		await expect(db.query('x')).rejects.toThrow();
		expect(conn.close).not.toHaveBeenCalled();
	});

	it('waits for the in-flight query before closing', async () => {
		const running = deferred<unknown[]>();
		const conn = fakeConnection(() => running.promise);
		const db = new Db('DSN=test;');
		const query = db.query('slow');
		await vi.waitFor(() => expect(conn.query).toHaveBeenCalledWith('slow', expect.anything()));

		const closed = db.close();
		await Promise.resolve();
		expect(conn.close).not.toHaveBeenCalled();
		running.resolve([]);
		await Promise.all([query, closed]);
		expect(conn.close).toHaveBeenCalledTimes(1);
	});

	it('closing an unopened Db is a no-op', async () => {
		await expect(new Db('DSN=test;').close()).resolves.toBeUndefined();
		expect(odbc.connect).not.toHaveBeenCalled();
	});
});
