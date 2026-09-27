#!/usr/bin/env node
// Generates a realistic mixed workload against the demo server (see demo/README.md).
// Each worker connects as its own application, login and host, so mssqltop shows a varied process list.
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {DRIVER, PASSWORD, SERVER} from './config.mjs';

// The odbc package runs each query on libuv's threadpool (4 threads by default). With workers blocked
// on locks for seconds at a time that would throttle the whole generator, so re-run with a bigger pool.
if (!process.env.UV_THREADPOOL_SIZE) {
	const child = spawn(process.execPath, process.argv.slice(1), {
		stdio: 'inherit',
		env: {...process.env, UV_THREADPOOL_SIZE: '64'},
	});
	child.on('exit', code => process.exit(code ?? 0));
	process.on('SIGINT', () => {}); // let the child handle Ctrl-C
} else {
	await main();
}

async function main() {
	const {values: args} = parseArgs({
		options: {
			storefront: {type: 'string', default: '12'},
			duration: {type: 'string'},
			help: {type: 'boolean', short: 'h'},
		},
	});
	if (args.help) {
		console.log('Usage: node demo/load.mjs [--storefront <workers>] [--duration <seconds>]');
		return;
	}

	const {default: odbc} = await import('odbc');
	const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
	const pick = items => items[rand(0, items.length - 1)];
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	const CATEGORIES = [
		'Electronics',
		'Books',
		'Garden',
		'Toys',
		'Kitchen',
		'Sports',
		'Clothing',
		'Music',
		'Office',
		'Outdoors',
		'Health',
		'Automotive',
	];
	const REGIONS = ['North', 'South', 'East', 'West', 'Central'];

	/** Each workload: who it connects as, what it runs, and how long it pauses between calls. */
	const workloads = [
		{
			name: 'storefront',
			app: 'Storefront Web',
			login: 'web_app',
			hosts: ['WEB01', 'WEB02', 'WEB03'],
			database: 'ShopDemo',
			workers: Number(args.storefront),
			pauseMs: () => rand(20, 100),
			sql: () => {
				const r = Math.random();
				if (r < 0.6) return `EXEC dbo.GetProduct @ProductId = ${rand(1, 2000)}`;
				if (r < 0.85) return `EXEC dbo.GetCustomerOrders @CustomerId = ${rand(1, 20000)}`;
				return `EXEC dbo.PlaceOrder @CustomerId = ${rand(1, 20000)}, @ProductId = ${rand(1, 2000)}, @Quantity = ${rand(1, 3)}`;
			},
		},
		{
			name: 'reports',
			app: 'Reports Service',
			login: 'reporting',
			hosts: ['REPORTS01'],
			database: 'ShopDemo',
			workers: 2,
			pauseMs: () => rand(1000, 4000),
			sql: () =>
				Math.random() < 0.6
					? `EXEC dbo.SalesByCategory @Days = ${pick([30, 90, 365, 730])}`
					: `EXEC dbo.TopCustomers @Region = '${pick(REGIONS)}'`,
		},
		{
			name: 'inventory',
			app: 'Inventory Sync',
			login: 'etl_service',
			hosts: ['ETL01'],
			database: 'ShopDemo',
			workers: 1,
			pauseMs: () => rand(6000, 12000),
			// Holds locks on a category for a few seconds: blocked sessions and a head blocker, now and then.
			sql: () => `EXEC dbo.RestockCategory @Category = '${pick(CATEGORIES)}', @HoldSeconds = ${rand(2, 4)}`,
		},
		{
			name: 'etl',
			app: 'Nightly ETL',
			login: 'etl_service',
			hosts: ['ETL01'],
			database: 'Warehouse',
			workers: 1,
			pauseMs: () => rand(1000, 3000),
			sql: () => `EXEC dbo.LoadSalesFact @DaysAgo = ${rand(0, 700)}`,
		},
		{
			name: 'adhoc',
			app: 'Ad-hoc Query',
			login: 'analyst',
			hosts: ['DEV-LAPTOP'],
			database: 'ShopDemo',
			workers: 1,
			pauseMs: () => rand(3000, 8000),
			// A CPU-heavy, parallel query that shows up in Active Expensive Queries.
			sql: () => `SELECT COUNT_BIG(*) AS pairs, SUM(CAST(CHECKSUM(a.Email, b.Email) AS bigint) % 7) AS noise
FROM dbo.Customers a
CROSS JOIN (SELECT TOP (${rand(1000, 2000)}) Email FROM dbo.Customers ORDER BY NEWID()) b
WHERE a.Region = '${pick(REGIONS)}'`,
		},
	];

	const braced = v => `{${v.replace(/}/g, '}}')}}`;
	const connectionString = (w, host) =>
		`Driver={${DRIVER}};Server=${SERVER};Database=${w.database};UID=${w.login};PWD=${braced(PASSWORD)};` +
		`APP=${w.app};WSID=${host};TrustServerCertificate=yes;`;

	const stats = Object.fromEntries(workloads.map(w => [w.name, {calls: 0, errors: 0}]));
	let lastError = '';
	let stopping = false;

	async function worker(w, index) {
		const host = w.hosts[index % w.hosts.length];
		let conn = null;
		// Stagger startup so the charts ramp up instead of spiking.
		await sleep(rand(0, 2000));
		while (!stopping) {
			try {
				conn ??= await odbc.connect({connectionString: connectionString(w, host), loginTimeout: 10});
				await conn.query(w.sql());
				stats[w.name].calls++;
			} catch (err) {
				stats[w.name].errors++;
				lastError = `${w.name}: ${err.odbcErrors?.[0]?.message ?? err.message}`.replace(/(\[[^\]]+\])+/g, '');
				await conn?.close().catch(() => {});
				conn = null;
				await sleep(1000);
			}
			await sleep(w.pauseMs());
		}
		await conn?.close().catch(() => {});
	}

	const stop = () => {
		if (stopping) process.exit(1);
		stopping = true;
		console.log('\nStopping (waiting for in-flight queries)… press Ctrl-C again to force.');
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
	if (args.duration) setTimeout(stop, Number(args.duration) * 1000);

	console.log(`Generating load against ${SERVER}. Watch it with:  npm run demo:top`);
	console.log('Press Ctrl-C to stop.\n');
	const report = setInterval(() => {
		const parts = workloads.map(
			w => `${w.name} ${stats[w.name].calls}${stats[w.name].errors ? ` (${stats[w.name].errors} err)` : ''}`,
		);
		console.log(
			`${new Date().toLocaleTimeString()}  ${parts.join('  ')}${lastError ? `\n  last error: ${lastError}` : ''}`,
		);
		lastError = '';
	}, 5000);

	await Promise.all(workloads.flatMap(w => Array.from({length: w.workers}, (_, i) => worker(w, i))));
	clearInterval(report);
}
