#!/usr/bin/env node
// Runs mssqltop against the demo server as the least-privilege `mssqltop` login. Extra arguments are passed through.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DRIVER, PASSWORD, SERVER} from './config.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
if (!existsSync(cli)) {
	console.error('mssqltop is not built yet: run `npm run build` first.');
	process.exit(1);
}
const {status} = spawnSync(
	process.execPath,
	[cli, '-S', SERVER, '-U', 'mssqltop', '-P', PASSWORD, '--driver', DRIVER, ...process.argv.slice(2)],
	{stdio: 'inherit'},
);
process.exit(status ?? 0);
