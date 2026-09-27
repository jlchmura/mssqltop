import {describe, expect, it} from 'vitest';
import {
	buildConnectionString,
	odbcValue,
	serverFromConnectionString,
	type ConnectOptions,
} from './connection-string.js';

const base: ConnectOptions = {
	server: 'db1.corp.example.com',
	driver: 'ODBC Driver 18 for SQL Server',
	trustServerCertificate: true,
};

describe('buildConnectionString', () => {
	it('builds a trusted connection by default', () => {
		expect(buildConnectionString(base)).toBe(
			'Driver={ODBC Driver 18 for SQL Server};Server=db1.corp.example.com;Database=master;APP=mssqltop;' +
				'Trusted_Connection=yes;TrustServerCertificate=yes;',
		);
	});

	it('uses a SQL login instead of a trusted connection when a user is given', () => {
		const cs = buildConnectionString({...base, user: 'monitor', password: 'secret'});
		expect(cs).toContain('UID=monitor;PWD={secret};');
		expect(cs).not.toContain('Trusted_Connection');
	});

	it('escapes braces and separators in the password', () => {
		expect(buildConnectionString({...base, user: 'sa', password: 'p}w;d'})).toContain('PWD={p}}w;d};');
	});

	it('honors the database and strict certificate options', () => {
		const cs = buildConnectionString({...base, database: 'Sales', trustServerCertificate: false});
		expect(cs).toContain('Database=Sales;');
		expect(cs).not.toContain('TrustServerCertificate');
	});

	it('returns a user-supplied connection string verbatim', () => {
		expect(buildConnectionString({...base, connectionString: 'DSN=prod;'})).toBe('DSN=prod;');
	});
});

describe('odbcValue', () => {
	it.each([
		['plain', 'plain'],
		['host,1433', 'host,1433'],
		['host\\INSTANCE', 'host\\INSTANCE'],
		['a;b', '{a;b}'],
		['x}y', '{x}}y}'],
		[' padded', '{ padded}'],
	])('%j → %j', (input, expected) => {
		expect(odbcValue(input)).toBe(expected);
	});
});

describe('serverFromConnectionString', () => {
	it.each([
		['Driver={x};Server=tcp:db1,1433;UID=a', 'tcp:db1,1433'],
		['Data Source=db2;Initial Catalog=x', 'db2'],
		['server = db3 ;', 'db3 '],
		['Server={we;ird};', 'we;ird'],
		['DSN=prod;', undefined],
	])('%j → %j', (cs, expected) => {
		expect(serverFromConnectionString(cs)).toBe(expected);
	});
});
