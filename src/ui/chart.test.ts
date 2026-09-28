import {describe, expect, it} from 'vitest';
import {GREEN, LABEL_WIDTH, chartTitle, gradientAt, renderChart as render, type ChartSpec} from './chart.js';

/** Most of these tests check exact braille glyphs, so they opt in to braille unless the spec says otherwise. */
const renderChart = (spec: ChartSpec) => render({style: 'braille', ...spec});
import type {Seg} from './segments.js';

const text = (line: Seg[]) => line.map(s => s.text).join('');
/** Just the plot part of each line (labels stripped). */
const plot = (lines: Seg[][]) => lines.map(l => text(l).slice(0, -LABEL_WIDTH));

const FULL = '⣿';
const LEFT_COLUMN = '⡇';
const ONE_RIGHT_DOT = '⢀';

/** Decodes a one-row chart back into dot-column heights (0–4), left to right. */
function dotColumns(line: string): number[] {
	const count = (bits: number, mask: readonly number[]) => mask.filter(m => bits & m).length;
	return [...line].flatMap(ch => {
		const bits = ch.codePointAt(0)! - 0x2800;
		if (bits < 0 || bits > 0xff) return [0, 0];
		return [count(bits, [0x40, 0x04, 0x02, 0x01]), count(bits, [0x80, 0x20, 0x10, 0x08])];
	});
}

describe('renderChart', () => {
	it('draws gridlines at the quarter marks and labels max and zero', () => {
		const lines = renderChart({values: [], width: 8, rows: 4});
		expect(lines.map(text)).toEqual(['      10', '┈┈      ', '┈┈      ', '┈┈     0']);
	});

	it('fills every dot for values at the maximum', () => {
		const lines = renderChart({values: [10, 10, 10, 10], width: 8, rows: 2, max: 10});
		expect(plot(lines)).toEqual([FULL.repeat(2), FULL.repeat(2)]);
	});

	it('fills half the height for values at half the maximum', () => {
		const lines = renderChart({values: [5, 5, 5, 5], width: 8, rows: 2, max: 10});
		expect(plot(lines)).toEqual(['  ', FULL.repeat(2)]);
	});

	it('right-aligns data (newest at the right) and draws each sample in its own dot column', () => {
		const lines = renderChart({values: [10, 0], width: 8, rows: 2, max: 10});
		expect(plot(lines)).toEqual([` ${LEFT_COLUMN}`, `┈${LEFT_COLUMN}`]);
	});

	it('gives any non-zero value at least one dot', () => {
		const lines = renderChart({values: [0.01], width: 8, rows: 2, max: 100});
		expect(plot(lines)[1]).toBe(`┈${ONE_RIGHT_DOT}`);
	});

	it('slides one dot column per sample, like btop', () => {
		const series = [4, 0, 1, 3, 0, 2, 4];
		for (let n = 1; n <= series.length; n++) {
			const values = series.slice(0, n);
			const [line] = plot(renderChart({values, width: 12, rows: 1, max: 4}));
			// Sample i always lands in dot column i counted from the right, whatever the count's parity.
			expect(dotColumns(line!).slice(-n)).toEqual(values);
		}
	});

	it('only plots the most recent samples that fit', () => {
		const lines = renderChart({values: [10, 10, 0, 0, 0, 0], width: 8, rows: 1, max: 10});
		expect(plot(lines)).toEqual(['  ']);
	});

	it('auto-scales to a readable maximum', () => {
		const lines = renderChart({values: [0, 37], width: 8, rows: 2});
		expect(text(lines[0]!)).toMatch(/50$/);
	});

	it('adds a midpoint label on taller charts', () => {
		const lines = renderChart({values: [], width: 10, rows: 6, max: 100});
		expect(text(lines[3]!)).toMatch(/50$/);
	});

	it('colors each row along the gradient, darkest at the bottom', () => {
		const lines = renderChart({values: [10, 10, 10, 10], width: 8, rows: 3, max: 10});
		const colors = lines.map(line => line.find(seg => seg.text.includes(FULL))?.color);
		expect(colors).toEqual([GREEN[2], GREEN[1], GREEN[0]]);
	});

	it('gives a whole row one color, so it never changes as the chart scrolls', () => {
		const [line] = renderChart({values: [10, 3, 7, 1, 9, 10], width: 9, rows: 1, max: 10});
		const dataColors = new Set(line!.filter(seg => /[\u2801-\u28ff]/.test(seg.text)).map(seg => seg.color));
		expect(dataColors.size).toBe(1);
	});

	it('accepts a custom gradient', () => {
		const [line] = renderChart({values: [10, 10], width: 8, rows: 1, max: 10, gradient: ['red', 'yellow']});
		expect(line!.find(seg => seg.text.includes(FULL))?.color).toBe('yellow');
	});

	it('draws gridlines dim gray', () => {
		const [, bottom] = renderChart({values: [], width: 8, rows: 2, max: 10});
		expect(bottom!.find(s => s.text.includes('┈'))).toMatchObject({color: 'gray', dim: true});
	});
});

describe('renderChart with block characters', () => {
	it('is the default style', () => {
		expect(
			render({values: [10, 10], width: 8, rows: 1, max: 10}).map(line => line.map(seg => seg.text).join(''))[0],
		).toContain('█');
	});

	const bottom = (values: number[], rows = 1) =>
		plot(renderChart({values, width: 8, rows, max: 10, style: 'block'})).at(-1);

	it('draws two samples per character as quadrant blocks', () => {
		expect(bottom([10, 10])).toBe(' █');
		expect(bottom([10, 0])).toBe(' ▌');
		expect(bottom([0, 10])).toBe(' ▐');
	});

	it('uses the lower half for values in the bottom half of a character', () => {
		expect(bottom([5, 5])).toBe(' ▄');
		expect(bottom([10, 5])).toBe(' ▙');
		expect(bottom([1, 0])).toBe(' ▖');
	});

	it('stacks across rows like the braille style', () => {
		expect(plot(renderChart({values: [10, 5], width: 8, rows: 2, max: 10, style: 'block'}))).toEqual([' ▌', '┈█']);
	});

	it('keeps the gridlines, labels and row colors', () => {
		const lines = renderChart({values: [10, 10], width: 8, rows: 2, max: 10, style: 'block'});
		expect(text(lines[0]!)).toBe(' █    10');
		expect(lines[0]!.find(seg => seg.text.includes('█'))?.color).toBe(GREEN[2]);
	});
});

describe('gradientAt', () => {
	it('returns the end stops at 0 and 1', () => {
		expect(gradientAt(['#000000', '#ffffff'], 0)).toBe('#000000');
		expect(gradientAt(['#000000', '#ffffff'], 1)).toBe('#ffffff');
	});

	it('interpolates hex colors between stops', () => {
		expect(gradientAt(['#000000', '#ffffff'], 0.5)).toBe('#808080');
		expect(gradientAt(['#000000', '#ff0000', '#ffff00'], 0.75)).toBe('#ff8000');
	});

	it('clamps out-of-range positions and handles single stops and named colors', () => {
		expect(gradientAt(['#000000', '#ffffff'], 2)).toBe('#ffffff');
		expect(gradientAt(['#123456'], 0.5)).toBe('#123456');
		expect(gradientAt(['green', 'greenBright'], 0.9)).toBe('greenBright');
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
