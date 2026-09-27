/** Command-line parsing, kept free of side effects so it can be tested. */
import {parseArgs} from 'node:util';
import {serverFromConnectionString, type ConnectOptions} from './db/connection-string.js';

export const USAGE = `mssqltop — htop-style activity monitor for Microsoft SQL Server

Usage:
  mssqltop -S <server> [options]

Connection:
  -S, --server <host[,port]|host\\instance>   SQL Server to monitor (or $MSSQLTOP_SERVER)
  -d, --database <name>        Initial database (default: master)
  -U, --user <login>           SQL login; omit to use a trusted (Kerberos) connection
  -P, --password <password>    Password for --user (or $MSSQLTOP_PASSWORD)
      --driver <name>          ODBC driver (default: "ODBC Driver 18 for SQL Server")
      --strict-certificate     Validate the server certificate (default: trust it)
      --connection-string <s>  Full ODBC connection string; overrides the options above

Refresh:
  -i, --interval <seconds>     Overview/process refresh interval (default: 2)
      --recent-interval <s>    Recent expensive queries poll interval (default: 10)
      --recent-window <s>      Window the recent expensive query rates cover (default: 60)

  -h, --help                   Show this help
  -v, --version                Show the version

Requires VIEW SERVER STATE. Press ? inside the app for key bindings.
`;

export const DEFAULT_DRIVER = 'ODBC Driver 18 for SQL Server';

export interface CliOptions {
	connection: ConnectOptions;
	/** Server name for display while connecting. */
	target: string;
	intervalMs: number;
	recentIntervalMs: number;
	recentWindowSec: number;
}

export type ParsedArgs =
	{kind: 'run'; options: CliOptions} | {kind: 'help'} | {kind: 'version'} | {kind: 'error'; message: string};

export function parseCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): ParsedArgs {
	let values;
	try {
		({values} = parseArgs({
			args: [...argv],
			options: {
				server: {type: 'string', short: 'S'},
				database: {type: 'string', short: 'd'},
				user: {type: 'string', short: 'U'},
				password: {type: 'string', short: 'P'},
				driver: {type: 'string', default: DEFAULT_DRIVER},
				'strict-certificate': {type: 'boolean', default: false},
				'connection-string': {type: 'string'},
				interval: {type: 'string', short: 'i', default: '2'},
				'recent-interval': {type: 'string', default: '10'},
				'recent-window': {type: 'string', default: '60'},
				help: {type: 'boolean', short: 'h'},
				version: {type: 'boolean', short: 'v'},
			},
		}));
	} catch (err) {
		return {kind: 'error', message: (err as Error).message};
	}

	if (values.help) return {kind: 'help'};
	if (values.version) return {kind: 'version'};

	const server = values.server ?? env.MSSQLTOP_SERVER;
	const connectionString = values['connection-string'];
	if (!server && !connectionString) return {kind: 'error', message: 'Missing --server (or --connection-string).'};

	const seconds: Array<[name: string, value: string]> = [
		['interval', values.interval],
		['recent-interval', values['recent-interval']],
		['recent-window', values['recent-window']],
	];
	for (const [name, value] of seconds) {
		const n = Number(value);
		if (!Number.isFinite(n) || n <= 0)
			return {kind: 'error', message: `--${name} must be a positive number of seconds.`};
	}

	return {
		kind: 'run',
		options: {
			connection: {
				server: server ?? '',
				database: values.database,
				user: values.user,
				password: values.password ?? env.MSSQLTOP_PASSWORD,
				driver: values.driver,
				trustServerCertificate: !values['strict-certificate'],
				connectionString,
			},
			target: server ?? (connectionString && serverFromConnectionString(connectionString)) ?? 'server',
			intervalMs: Number(values.interval) * 1000,
			recentIntervalMs: Number(values['recent-interval']) * 1000,
			recentWindowSec: Number(values['recent-window']),
		},
	};
}
