import {describe, expect, it} from 'vitest';
import {DEFAULT_DRIVER, parseCli} from './args.js';

const run = (argv: string[], env: Record<string, string> = {}) => {
	const parsed = parseCli(argv, env);
	if (parsed.kind !== 'run') throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
	return parsed.options;
};

describe('parseCli', () => {
	it('parses a trusted connection with defaults', () => {
		expect(run(['-S', 'db1'])).toEqual({
			connection: {
				server: 'db1',
				database: undefined,
				user: undefined,
				password: undefined,
				driver: DEFAULT_DRIVER,
				trustServerCertificate: true,
				connectionString: undefined,
			},
			target: 'db1',
			intervalMs: 2000,
			recentIntervalMs: 10_000,
			recentWindowSec: 60,
		});
	});

	it('parses SQL logins and every option', () => {
		const options = run([
			'--server=db1,1433',
			'-d',
			'Sales',
			'-U',
			'mon',
			'-P',
			'pw',
			'--driver',
			'ODBC Driver 17 for SQL Server',
			'--strict-certificate',
			'-i',
			'0.5',
			'--recent-interval',
			'30',
			'--recent-window',
			'120',
		]);
		expect(options.connection).toMatchObject({
			server: 'db1,1433',
			database: 'Sales',
			user: 'mon',
			password: 'pw',
			driver: 'ODBC Driver 17 for SQL Server',
			trustServerCertificate: false,
		});
		expect(options).toMatchObject({intervalMs: 500, recentIntervalMs: 30_000, recentWindowSec: 120});
	});

	it('reads the server and password from the environment', () => {
		expect(run(['-U', 'mon'], {MSSQLTOP_SERVER: 'envdb', MSSQLTOP_PASSWORD: 'envpw'}).connection).toMatchObject({
			server: 'envdb',
			password: 'envpw',
		});
	});

	it('prefers flags over the environment', () => {
		expect(run(['-S', 'flagdb'], {MSSQLTOP_SERVER: 'envdb'}).target).toBe('flagdb');
	});

	it('accepts a raw connection string and derives the display target from it', () => {
		const options = run(['--connection-string', 'Driver={x};Server=tcp:db9;UID=a;PWD=b;']);
		expect(options.connection.connectionString).toBe('Driver={x};Server=tcp:db9;UID=a;PWD=b;');
		expect(options.target).toBe('tcp:db9');
	});

	it('recognizes --help and --version', () => {
		expect(parseCli(['--help'], {})).toEqual({kind: 'help'});
		expect(parseCli(['-v'], {})).toEqual({kind: 'version'});
	});

	it.each([
		[[], /Missing --server/],
		[['-S', 'db', '-i', '0'], /--interval must be a positive number/],
		[['-S', 'db', '--recent-window', 'abc'], /--recent-window must be a positive number/],
		[['-S', 'db', '--bogus'], /Unknown option/],
		[['-S', 'db', 'extra'], /Unexpected argument/],
	])('rejects %j', (argv, message) => {
		const parsed = parseCli(argv, {});
		expect(parsed.kind).toBe('error');
		expect(parsed.kind === 'error' && parsed.message).toMatch(message);
	});
});
