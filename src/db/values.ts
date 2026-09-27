/** A result row keyed by column name, as returned by the ODBC driver. */
export type Row = Record<string, unknown>;

const HIGH_BYTES = /[\x80-\xff]/;
const BEYOND_BYTES = /[^\x00-\xff]/;
const strictUtf8 = new TextDecoder('utf-8', {fatal: true});

/**
 * On macOS/Linux the odbc binding (built without UNICODE) hands back the driver's UTF-8 output
 * one byte per UTF-16 unit, so non-ASCII text arrives as mojibake ("hÃ©llo"). Re-reading those
 * units as bytes recovers it exactly. The Windows build uses wide strings and is already correct,
 * so only repair strings that look like mojibake: every unit fits in a byte and the bytes are valid UTF-8.
 */
export function fixMojibake(s: string): string {
	if (!HIGH_BYTES.test(s) || BEYOND_BYTES.test(s)) return s;
	try {
		return strictUtf8.decode(Buffer.from(s, 'latin1'));
	} catch {
		return s;
	}
}

/**
 * Repairs text (see {@link fixMojibake}) and converts BIGINTs (which arrive as BigInt) and
 * BITs (which arrive as '0' / '1') to numbers. Mutates and returns `row`.
 */
export function normalizeRow(row: Row, bitColumns: ReadonlySet<string>): Row {
	for (const k in row) {
		const v = row[k];
		if (typeof v === 'string') row[k] = bitColumns.has(k) ? (v === '1' ? 1 : 0) : fixMojibake(v);
		else if (typeof v === 'bigint') row[k] = Number(v);
	}
	return row;
}

interface OdbcErrorDetail {
	state?: string;
	message?: string;
}

const odbcErrors = (err: unknown): OdbcErrorDetail[] =>
	(err as {odbcErrors?: OdbcErrorDetail[]} | null)?.odbcErrors ?? [];

/** True when the error means the connection itself is unusable and should be reopened. */
export function isConnectionError(err: unknown): boolean {
	return odbcErrors(err).some(
		e =>
			e.state?.startsWith('08') || /communication link|TCP Provider|connection is (closed|busy)/i.test(e.message ?? ''),
	);
}

/** The most useful one-line message for an error, without the ODBC driver's bracketed prefixes. */
export function errorMessage(err: unknown): string {
	const [first] = odbcErrors(err);
	const msg = first?.message ?? (err instanceof Error ? err.message : String(err));
	// "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Invalid object name…" → "Invalid object name…"
	return msg
		.replace(/(\[[^\]]+\])+\s*/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
