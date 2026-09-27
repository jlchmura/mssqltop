#!/usr/bin/env node
import {render} from 'ink';
import {parseArgs} from 'node:util';
import {Db, buildConnectionString, errorMessage} from './db.js';
import {Monitor} from './monitor.js';
import {App} from './components/App.js';

const USAGE = `mssqltop — htop-style activity monitor for Microsoft SQL Server

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

Requires VIEW SERVER STATE. Press ? inside the app for key bindings.
`;

function main() {
	let args;
	try {
		args = parseArgs({
			options: {
				server: {type: 'string', short: 'S'},
				database: {type: 'string', short: 'd'},
				user: {type: 'string', short: 'U'},
				password: {type: 'string', short: 'P'},
				driver: {type: 'string', default: 'ODBC Driver 18 for SQL Server'},
				'strict-certificate': {type: 'boolean', default: false},
				'connection-string': {type: 'string'},
				interval: {type: 'string', short: 'i', default: '2'},
				'recent-interval': {type: 'string', default: '10'},
				'recent-window': {type: 'string', default: '60'},
				help: {type: 'boolean', short: 'h'},
			},
			allowPositionals: true,
		}).values;
	} catch (err) {
		console.error(`${(err as Error).message}\n\n${USAGE}`);
		process.exit(2);
	}

	const server = args.server ?? process.env.MSSQLTOP_SERVER;
	if (args.help || (!server && !args['connection-string'])) {
		console.log(USAGE);
		process.exit(args.help ? 0 : 2);
	}
	if (!process.stdout.isTTY) {
		console.error('mssqltop needs an interactive terminal.');
		process.exit(2);
	}

	const seconds = (name: string, v: string | undefined) => {
		const n = Number(v);
		if (!Number.isFinite(n) || n <= 0) {
			console.error(`--${name} must be a positive number of seconds`);
			process.exit(2);
		}
		return n * 1000;
	};

	const cs = buildConnectionString({
		server: server ?? '',
		database: args.database,
		user: args.user,
		password: args.password ?? process.env.MSSQLTOP_PASSWORD,
		driver: args.driver!,
		trustServerCertificate: !args['strict-certificate'],
		connectionString: args['connection-string'],
	});

	// Two connections so the slow plan-cache scan never delays the 2-second refresh.
	const monitor = new Monitor(new Db(cs), new Db(cs, 120), {
		intervalMs: seconds('interval', args.interval),
		recentIntervalMs: seconds('recent-interval', args['recent-interval']),
		recentWindowSec: seconds('recent-window', args['recent-window']) / 1000,
	});

	const target = server ?? /Server=([^;]+)/i.exec(cs)?.[1] ?? 'server';
	const app = render(<App monitor={monitor} target={target} />, {alternateScreen: true, incrementalRendering: true, maxFps: 20});
	void monitor.start();

	app.waitUntilExit().then(
		async () => {
			await Promise.race([monitor.stop(), new Promise(r => setTimeout(r, 3000))]);
			process.exit(0);
		},
		err => {
			console.error(errorMessage(err));
			process.exit(1);
		},
	);
}

main();
