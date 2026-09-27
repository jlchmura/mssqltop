import {describe, expect, it} from 'vitest';
import {LABEL_WIDTH, chartTitle, renderChart} from './braille.js';
import type {Seg} from './segments.js';

const text = (line: Seg[]) => line.map(s => s.text).join('');
/** Just the plot part of each line (labels stripped). */
const plot = (lines: Seg[][]) => lines.map(l => text(l).slice(0, -LABEL_WIDTH));

const FULL = '⣿';
const LEFT_COLUMN = '⡇';
const ONE_RIGHT_DOT = '⢀';

describe('renderChart', () => {
	it('draws gridlines at the quarter marks and labels max and zero', () => {
		const lines = renderChart({values: [], width: 8, rows: 4, color: 'green'});
		expect(lines.map(text)).toEqual(['      10', '┈┈      ', '┈┈      ', '┈┈     0']);
	});

	it('fills every dot for values at the maximum', () => {
		const lines = renderChart({values: [10, 10, 10, 10], width: 8, rows: 2, max: 10, color: 'green'});
		expect(plot(lines)).toEqual([FULL.repeat(2), FULL.repeat(2)]);
	});

	it('fills half the height for values at half the maximum', () => {
		const lines = renderChart({values: [5, 5, 5, 5], width: 8, rows: 2, max: 10, color: 'green'});
		expect(plot(lines)).toEqual(['  ', FULL.repeat(2)]);
	});

	it('right-aligns data (newest at the right) and draws each sample in its own dot column', () => {
		const lines = renderChart({values: [10, 0], width: 8, rows: 2, max: 10, color: 'green'});
		expect(plot(lines)).toEqual([` ${LEFT_COLUMN}`, `┈${LEFT_COLUMN}`]);
	});

	it('gives any non-zero value at least one dot', () => {
		const lines = renderChart({values: [0.01], width: 8, rows: 2, max: 100, color: 'green'});
		expect(plot(lines)[1]).toBe(`┈${ONE_RIGHT_DOT}`);
	});

	it('only plots the most recent samples that fit', () => {
		const lines = renderChart({values: [10, 10, 0, 0, 0, 0], width: 8, rows: 1, max: 10, color: 'green'});
		expect(plot(lines)).toEqual(['  ']);
	});

	it('auto-scales to a readable maximum', () => {
		const lines = renderChart({values: [0, 37], width: 8, rows: 2, color: 'green'});
		expect(text(lines[0]!)).toMatch(/50$/);
	});

	it('adds a midpoint label on taller charts', () => {
		const lines = renderChart({values: [], width: 10, rows: 6, max: 100, color: 'green'});
		expect(text(lines[3]!)).toMatch(/50$/);
	});

	it('styles data bold in the chart color and gridlines dim', () => {
		const [top, bottom] = renderChart({values: [10, 0], width: 8, rows: 2, max: 10, color: 'green'});
		expect(top!.find(s => s.text.includes(LEFT_COLUMN))).toMatchObject({color: 'green', bold: true});
		expect(bottom!.find(s => s.text.includes('┈'))).toMatchObject({color: 'gray', dim: true});
	});
});

describe('chartTitle', () => {
	const titleText = (room: number) => text(chartTitle('% Processor Time', 'CPU', '12%', 'green', room));

	it('uses the full title when it fits', () => {
		expect(titleText(30)).toBe('% Processor Time (12%)');
	});

	it('falls back to the short title', () => {
		expect(titleText(15)).toBe('CPU (12%)');
	});

	it('uses the short title even when nothing fits (the frame truncates)', () => {
		expect(titleText(3)).toBe('CPU (12%)');
	});
});
