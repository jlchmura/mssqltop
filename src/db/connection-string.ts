export interface ConnectOptions {
	server: string;
	database?: string | undefined;
	/** SQL login; omit for a trusted (Kerberos / SSPI) connection. */
	user?: string | undefined;
	password?: string | undefined;
	driver: string;
	trustServerCertificate: boolean;
	/** A complete ODBC connection string; when set, every other option is ignored. */
	connectionString?: string | undefined;
}

export const APP_NAME = 'mssqltop';

/** ODBC values containing separators or braces must be wrapped in braces, with `}` doubled. */
export function odbcValue(value: string): string {
	return /[;{}=]|^\s|\s$/.test(value) ? `{${value.replace(/}/g, '}}')}}` : value;
}

export function buildConnectionString(o: ConnectOptions): string {
	if (o.connectionString) return o.connectionString;
	const parts: Array<[string, string]> = [
		['Driver', `{${o.driver}}`],
		['Server', odbcValue(o.server)],
		['Database', odbcValue(o.database ?? 'master')],
		['APP', APP_NAME],
	];
	if (o.user) {
		// Always brace the password so any character is allowed.
		parts.push(['UID', odbcValue(o.user)], ['PWD', `{${(o.password ?? '').replace(/}/g, '}}')}}`]);
	} else {
		parts.push(['Trusted_Connection', 'yes']);
	}
	if (o.trustServerCertificate) parts.push(['TrustServerCertificate', 'yes']);
	return parts.map(([k, v]) => `${k}=${v};`).join('');
}

/** Best-effort extraction of the server name for display, e.g. from a user-supplied connection string. */
export function serverFromConnectionString(connectionString: string): string | undefined {
	return /(?:^|;)\s*(?:Server|Data Source|Address|Addr)\s*=\s*(\{[^}]*\}|[^;]*)/i
		.exec(connectionString)?.[1]
		?.replace(/^\{|\}$/g, '');
}
