#!/usr/bin/env node
import {createRequire} from 'node:module';
import {render} from 'ink';
import {USAGE, parseCli} from './args.js';
import {buildConnectionString} from './db/connection-string.js';
import {Db} from './db/db.js';
import {errorMessage} from './db/values.js';
import {Monitor} from './monitor/monitor.js';
import {App} from './ui/App.js';

/** How long to wait for in-flight queries on exit before giving up on a clean close. */
const SHUTDOWN_TIMEOUT_MS = 3000;
/** The plan-cache scan can legitimately take a while on a big instance. */
const SLOW_QUERY_TIMEOUT_SEC = 120;

function main(): void {
	const parsed = parseCli(process.argv.slice(2), process.env);
	switch (parsed.kind) {
		case 'help':
			console.log(USAGE);
			return;
		case 'version':
			console.log(createRequire(import.meta.url)('../package.json').version);
			return;
		case 'error':
			console.error(`${parsed.message}\n\n${USAGE}`);
			process.exitCode = 2;
			return;
	}
	if (!process.stdout.isTTY) {
		console.error('mssqltop needs an interactive terminal.');
		process.exitCode = 2;
		return;
	}

	const {options} = parsed;
	const connectionString = buildConnectionString(options.connection);
	const monitor = new Monitor(
		new Db(connectionString),
		new Db(connectionString, {queryTimeoutSec: SLOW_QUERY_TIMEOUT_SEC}),
		{
			intervalMs: options.intervalMs,
			recentIntervalMs: options.recentIntervalMs,
			recentWindowSec: options.recentWindowSec,
		},
	);

	const app = render(<App monitor={monitor} target={options.target} graphStyle={options.graph} />, {
		alternateScreen: true,
		incrementalRendering: true,
		maxFps: 20,
	});
	monitor.start();

	app.waitUntilExit().then(
		async () => {
			await Promise.race([monitor.stop(), new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))]);
			// Pending ODBC work can keep the event loop alive; exit explicitly.
			process.exit(0);
		},
		(err: unknown) => {
			console.error(errorMessage(err));
			process.exit(1);
		},
	);
}

main();
