import odbc from 'odbc';

export type Row = Record<string, any>;

export interface ConnectOptions {
	server: string;
	database?: string;
	user?: string;
	password?: string;
	driver: string;
	trustServerCertificate: boolean;
	connectionString?: string;
}

export function buildConnectionString(o: ConnectOptions): string {
	if (o.connectionString) return o.connectionString;
	const parts = [
		`Driver={${o.driver}}`,
		`Server=${o.server}`,
		`Database=${o.database ?? 'master'}`,
		'APP=mssqltop',
	];
	if (o.user) {
		parts.push(`UID=${o.user}`, `PWD={${(o.password ?? '').replace(/}/g, '}}')}}`);
	} else {
		parts.push('Trusted_Connection=yes');
	}
	if (o.trustServerCertificate) parts.push('TrustServerCertificate=yes');
	return parts.join(';') + ';';
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

const HIGH_BYTES = /[\x80-\xff]/;
const SQL_BIT = -7;

/**
 * The odbc binding hands back the driver's UTF-8 output one byte per UTF-16 unit, so non-ASCII
 * text arrives as mojibake ("hÃ©llo"). Re-reading those units as bytes recovers it exactly.
 * BIGINTs arrive as BigInt and BITs as '0'/'1'; normalize both to numbers.
 */
function normalize(row: Row, bitColumns: Set<string>): Row {
	for (const k in row) {
		const v = row[k];
		if (typeof v === 'string') {
			if (bitColumns.has(k)) row[k] = v === '1' ? 1 : 0;
			else if (HIGH_BYTES.test(v)) row[k] = Buffer.from(v, 'latin1').toString('utf8');
		} else if (typeof v === 'bigint') {
			row[k] = Number(v);
		}
	}
	return row;
}

/** A single lazily-opened connection that reopens itself after a failure and runs one query at a time. */
export class Db {
	private conn: odbc.Connection | null = null;
	private opening: Promise<odbc.Connection> | null = null;
	private tail: Promise<unknown> = Promise.resolve();
	spid = 0;

	constructor(
		private readonly connectionString: string,
		private readonly queryTimeoutSec = 30,
		private readonly loginTimeoutSec = 15,
	) {}

	private async connection(): Promise<odbc.Connection> {
		if (this.conn) return this.conn;
		this.opening ??= (async () => {
			try {
				const c = await odbc.connect({connectionString: this.connectionString, loginTimeout: this.loginTimeoutSec});
				await c.query(SESSION_INIT);
				const [row] = await c.query<{spid: number}>('SELECT @@SPID AS spid');
				this.spid = Number(row?.spid ?? 0);
				this.conn = c;
				return c;
			} finally {
				this.opening = null;
			}
		})();
		return this.opening;
	}

	/** Runs one statement and returns its rows. Calls on the same Db are serialized. */
	query(text: string): Promise<Row[]> {
		const run = this.tail.then(() => this.run(text));
		this.tail = run.catch(() => {});
		return run;
	}

	private async run(text: string): Promise<Row[]> {
		const c = await this.connection();
		try {
			const result = await c.query(text, {timeout: this.queryTimeoutSec});
			const bits = new Set(result.columns.filter(col => col.dataType === SQL_BIT).map(col => col.name));
			return Array.from(result, row => normalize(row as Row, bits));
		} catch (err) {
			if (isConnectionError(err)) await this.reset();
			throw err;
		}
	}

	async reset(): Promise<void> {
		const c = this.conn;
		this.conn = null;
		if (c) await c.close().catch(() => {});
	}

	/** Closes after any in-flight query finishes; closing a busy ODBC handle can crash the process. */
	close(): Promise<void> {
		const done = this.tail.then(() => this.reset());
		this.tail = done;
		return done;
	}
}

interface OdbcError {
	state?: string;
	message?: string;
}

const odbcErrors = (err: unknown): OdbcError[] => (err as {odbcErrors?: OdbcError[]})?.odbcErrors ?? [];

function isConnectionError(err: unknown): boolean {
	return odbcErrors(err).some(e => e.state?.startsWith('08') || /communication link|TCP Provider|connection is (closed|busy)/i.test(e.message ?? ''));
}

export function errorMessage(err: unknown): string {
	const details = odbcErrors(err);
	const msg = details.length ? details[0]!.message! : ((err as Error)?.message ?? String(err));
	// Strip the driver prefix noise: "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]"
	return msg.replace(/(\[[^\]]+\])+\s*/g, '').replace(/\s+/g, ' ').trim();
}
