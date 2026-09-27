import {describe, expect, it} from 'vitest';
import {layoutColumns, scrollOffset, sortRows, type Column} from './table-model.js';

interface R {
	name: string;
	n: number | null;
}

const col = (id: string, width: number, extra: Partial<Column<R>> = {}): Column<R> => ({
	id,
	title: id,
	width,
	value: r => r.n,
	...extra,
});

describe('layoutColumns', () => {
	const a = col('a', 5, {priority: 0});
	const b = col('b', 5, {priority: 9});
	const c = col('c', 5, {priority: 1, flex: 1});

	const summary = (width: number, cols = [a, b, c]) => layoutColumns(cols, width).map(l => [l.col.id, l.width]);

	it('keeps every column when they fit exactly (1-column gaps)', () => {
		expect(summary(17)).toEqual([
			['a', 5],
			['b', 5],
			['c', 5],
		]);
	});

	it('drops the lowest-priority column first but keeps declared order', () => {
		expect(summary(12)).toEqual([
			['a', 5],
			['c', 6],
		]);
	});

	it('gives all leftover width to flex columns so the row fills the width', () => {
		const laid = layoutColumns([a, b, c], 30);
		expect(laid.map(l => l.width)).toEqual([5, 5, 18]);
		expect(laid.reduce((n, l) => n + l.width, 0) + laid.length - 1).toBe(30);
	});

	it('splits leftover width by flex weight, remainder to the first', () => {
		const d = col('d', 4, {flex: 2});
		const e = col('e', 4, {flex: 1});
		// 4 + 1 + 4 = 9 used, 11 spare: d gets floor(11*2/3)=7 (+1 remainder), e gets floor(11/3)=3.
		expect(summary(20, [d, e])).toEqual([
			['d', 12],
			['e', 7],
		]);
	});

	it('leaves widths alone when there are no flex columns', () => {
		expect(summary(40, [a, b])).toEqual([
			['a', 5],
			['b', 5],
		]);
	});

	it('treats a missing priority as 5', () => {
		const important = col('important', 10, {priority: 1});
		const normal = col('normal', 10);
		const trivial = col('trivial', 10, {priority: 9});
		expect(summary(21, [trivial, normal, important]).map(([id]) => id)).toEqual(['normal', 'important']);
	});
});

describe('sortRows', () => {
	const rows: R[] = [
		{name: 'a', n: 3},
		{name: 'b', n: null},
		{name: 'c', n: 1},
		{name: 'd', n: 2},
	];
	const names = (rs: R[]) => rs.map(r => r.name).join('');
	const byN = col('n', 5);

	it('sorts ascending with blanks last', () => {
		expect(names(sortRows(rows, byN, false))).toBe('cdab');
	});

	it('sorts descending with blanks still last', () => {
		expect(names(sortRows(rows, byN, true))).toBe('adcb');
	});

	it('sorts strings with localeCompare and treats empty strings as blank', () => {
		const byName = col('name', 5, {value: r => (r.name === 'c' ? '' : r.name)});
		expect(names(sortRows(rows, byName, true))).toBe('dbac');
	});

	it('breaks ties with the tiebreaker, ascending regardless of direction', () => {
		const tied: R[] = [
			{name: 'x', n: 1},
			{name: 'y', n: 1},
			{name: 'z', n: 1},
		];
		const order = {x: 3, y: 1, z: 2} as Record<string, number>;
		expect(names(sortRows(tied, byN, true, r => order[r.name]!))).toBe('yzx');
	});

	it('returns a copy in the original order without a column, and never mutates', () => {
		const copy = [...rows];
		expect(sortRows(rows, undefined, false)).toEqual(rows);
		sortRows(rows, byN, false);
		expect(rows).toEqual(copy);
	});
});

describe('scrollOffset', () => {
	it('keeps the viewport when the selection is visible', () => {
		expect(scrollOffset(0, 5, 10, 100)).toBe(0);
	});

	it('scrolls down just enough to show the selection', () => {
		expect(scrollOffset(0, 15, 10, 100)).toBe(6);
	});

	it('scrolls up to the selection', () => {
		expect(scrollOffset(10, 3, 10, 100)).toBe(3);
	});

	it('never scrolls past the last page', () => {
		expect(scrollOffset(95, 99, 10, 100)).toBe(90);
	});

	it('stays at 0 when everything fits', () => {
		expect(scrollOffset(5, 2, 10, 3)).toBe(0);
	});
});
