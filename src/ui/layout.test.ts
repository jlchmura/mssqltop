import {describe, expect, it} from 'vitest';
import {computeLayout, visibleRows, type LayoutInput} from './layout.js';

const input = (overrides: Partial<LayoutInput> = {}): LayoutInput => ({
	width: 100,
	height: 40,
	showCharts: true,
	maximized: false,
	focus: 'processes',
	...overrides,
});

describe('computeLayout', () => {
	it('splits a normal terminal between charts and the two panels', () => {
		expect(computeLayout(input())).toEqual({
			chartsVisible: true,
			chartHeight: 8,
			chartWidths: [25, 25, 25, 25],
			processesHeight: 17,
			queriesHeight: 13,
			overlayHeight: 38,
		});
	});

	it('uses every row: header + charts + panels + footer = height', () => {
		for (const height of [24, 30, 41, 60]) {
			const l = computeLayout(input({height}));
			expect(1 + l.chartHeight + l.processesHeight + l.queriesHeight + 1).toBe(height);
		}
	});

	it('gives the last chart the leftover columns', () => {
		expect(computeLayout(input({width: 103})).chartWidths).toEqual([25, 25, 25, 28]);
	});

	it('hides the charts on short terminals or when toggled off', () => {
		expect(computeLayout(input({height: 20})).chartsVisible).toBe(false);
		expect(computeLayout(input({showCharts: false})).chartHeight).toBe(0);
	});

	it('gives the whole body to the focused panel when maximized', () => {
		expect(computeLayout(input({maximized: true}))).toMatchObject({
			chartsVisible: false,
			processesHeight: 38,
			queriesHeight: 0,
		});
		expect(computeLayout(input({maximized: true, focus: 'queries'}))).toMatchObject({
			processesHeight: 0,
			queriesHeight: 38,
		});
	});

	it('never produces negative heights on tiny terminals', () => {
		const l = computeLayout(input({height: 5}));
		expect(l.processesHeight).toBe(3);
		expect(l.queriesHeight).toBe(0);
	});
});

describe('visibleRows', () => {
	it('subtracts the frame and column header, with at least one row', () => {
		expect(visibleRows(10)).toBe(7);
		expect(visibleRows(2)).toBe(1);
	});
});
