import {describe, expect, it} from 'vitest';
import {activeRow, processRow, recentRow} from '../test/fixtures.js';
import {activeColumns, processColumns, recentColumns} from './columns.js';
import type {Column} from './table-model.js';

const cell = <T>(cols: Column<T>[], id: string, row: T) => {
	const col = cols.find(c => c.id === id)!;
	return {text: col.text ? col.text(row) : String(col.value(row) ?? ''), color: col.color?.(row)};
};

const tables = {
	processes: [processColumns(true), processRow(), processRow({waitTimeMs: null, blockedBy: null, headBlocker: false})],
	recent: [recentColumns, recentRow(), recentRow({cpuMsPerSec: 0})],
	active: [activeColumns, activeRow(), activeRow({cpuMsPerSec: null, grantedKb: null})],
} as const;

describe.each(Object.entries(tables))('%s columns', (_, [cols, ...rows]) => {
	const columns = cols as Column<unknown>[];

	it('have unique ids', () => {
		expect(new Set(columns.map(c => c.id)).size).toBe(columns.length);
	});

	it('produce a sort key, display text and color for every cell, including null values', () => {
		for (const row of rows) {
			for (const col of columns) {
				expect(['string', 'number', 'object']).toContain(typeof col.value(row));
				if (col.text) expect(typeof col.text(row)).toBe('string');
				col.color?.(row);
			}
		}
	});
});

describe('process columns', () => {
	const cols = processColumns(true);

	it('only include the Tasks count when grouped by session', () => {
		expect(cols.some(c => c.id === 'tasks')).toBe(true);
		expect(processColumns(false).some(c => c.id === 'tasks')).toBe(false);
	});

	it('color task states, waits and blocking', () => {
		expect(cell(cols, 'task', processRow({taskState: 'RUNNING'})).color).toBe('green');
		expect(cell(cols, 'task', processRow({taskState: 'SUSPENDED'})).color).toBe('blue');
		expect(cell(cols, 'waittype', processRow({waitType: 'LCK_M_S'})).color).toBe('yellow');
		expect(cell(cols, 'blockedby', processRow({blockedBy: 60}))).toEqual({text: '60', color: 'red'});
		expect(cell(cols, 'head', processRow({headBlocker: true}))).toEqual({text: '1', color: 'red'});
	});

	it('format numbers with separators and leave blanks blank', () => {
		expect(cell(cols, 'cpu', processRow({cpuMs: 1234567})).text).toBe('1,234,567');
		expect(cell(cols, 'waitms', processRow({waitTimeMs: null})).text).toBe('');
		expect(cell(cols, 'tran', processRow({openTran: 0})).text).toBe('');
		expect(cell(cols, 'tasks', processRow({tasks: 0})).text).toBe('');
	});
});

describe('query columns', () => {
	it('show SQL text on one line', () => {
		expect(cell(activeColumns, 'query', activeRow({text: 'SELECT\n\t*\n FROM t'})).text).toBe('SELECT * FROM t');
		expect(cell(recentColumns, 'query', recentRow({text: 'UPDATE\r\nt'})).text).toBe('UPDATE t');
	});

	it('format rates and leave unknown rates blank', () => {
		expect(cell(recentColumns, 'cpu', recentRow({cpuMsPerSec: 12.345})).text).toBe('12.3');
		expect(cell(activeColumns, 'cpurate', activeRow({cpuMsPerSec: null})).text).toBe('');
	});
});
