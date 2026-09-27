import odbc from 'odbc';
import {isConnectionError, normalizeRow, type Row} from './values.js';

/** What the monitor needs from a database connection; lets tests substitute a fake. */
export interface QueryRunner {
	/** Server process id of this connection, once open (0 before). */
	readonly spid: number;
	query(text: string): Promise<Row[]>;
	close(): Promise<void>;
}

// Monitoring must never block or be blocked by the workload it is watching.
const SESSION_INIT = `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET LOCK_TIMEOUT 5000;
SET DEADLOCK_PRIORITY LOW;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
`;

const SQL_BIT = -7;

export interface DbOptions {
	queryTimeoutSec?: number;
	loginTimeoutSec?: number;
}

/** A single lazily-opened ODBC connection that reopens itself after a failure and runs one query at a time. */
export class Db implements QueryRunner {
	spid = 0;
	private conn: odbc.Connection | null = null;
	private opening: Promise<odbc.Connection> | null = null;
	private tail: Promise<unknown> = Promise.resolve();
	private readonly queryTimeoutSec: number;
	private readonly loginTimeoutSec: number;

	constructor(
		private readonly connectionString: string,
		{queryTimeoutSec = 30, loginTimeoutSec = 15}: DbOptions = {},
	) {
		this.queryTimeoutSec = queryTimeoutSec;
		this.loginTimeoutSec = loginTimeoutSec;
	}

	/** Runs one statement and returns its rows. Calls on the same Db are serialized. */
	query(text: string): Promise<Row[]> {
		return this.enqueue(() => this.run(text));
	}

	/** Closes after any in-flight query finishes; closing a busy ODBC handle can crash the process. */
	close(): Promise<void> {
		return this.enqueue(() => this.reset());
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task);
		this.tail = result.catch(() => {});
		return result;
	}

	private async run(text: string): Promise<Row[]> {
		const conn = await this.connection();
		try {
			const result = await conn.query(text, {timeout: this.queryTimeoutSec});
			const bits = new Set(result.columns.filter(c => c.dataType === SQL_BIT).map(c => c.name));
			return Array.from(result, row => normalizeRow(row as Row, bits));
		} catch (err) {
			if (isConnectionError(err)) await this.reset();
			throw err;
		}
	}

	private async connection(): Promise<odbc.Connection> {
		if (this.conn) return this.conn;
		this.opening ??= (async () => {
			try {
				const conn = await odbc.connect({connectionString: this.connectionString, loginTimeout: this.loginTimeoutSec});
				await conn.query(SESSION_INIT);
				const [row] = await conn.query<{spid: number}>('SELECT @@SPID AS spid');
				this.spid = Number(row?.spid ?? 0);
				this.conn = conn;
				return conn;
			} finally {
				this.opening = null;
			}
		})();
		return this.opening;
	}

	private async reset(): Promise<void> {
		const conn = this.conn;
		this.conn = null;
		if (conn) await conn.close().catch(() => {});
	}
}
