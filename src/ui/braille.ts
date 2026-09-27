/** Renders a series as an area chart made of braille characters (2 dots wide × 4 tall per cell). */
import {fmtCompact, niceCeil} from './format.js';
import type {Seg} from './segments.js';

// Bits for each dot column of a braille cell, listed bottom-up.
const LEFT_BITS = [0x40, 0x04, 0x02, 0x01] as const;
const RIGHT_BITS = [0x80, 0x20, 0x10, 0x08] as const;
const BRAILLE_BASE = 0x2800;
// Not braille: many fonts draw a braille cell's unused dots faintly, which made a braille grid
// look like data. A thin dashed rule reads clearly as background.
const GRID_CHAR = '┈';
/** Room for the y-axis labels at the right edge of the plot. */
export const LABEL_WIDTH = 6;

export interface ChartSpec {
	values: readonly number[];
	/** Width in columns, including the label area. */
	width: number;
	rows: number;
	/** Fixed y-axis maximum (e.g. 100 for percentages); otherwise auto-scaled from the visible values. */
	max?: number | undefined;
	/** Smallest auto-scaled maximum, so a quiet server doesn't magnify noise. */
	minMax?: number | undefined;
	color: string;
}

/** The chart as lines of segments: plot on the left, y-axis labels (max, mid, 0) on the right. */
export function renderChart({values, width, rows, max, minMax = 10, color}: ChartSpec): Seg[][] {
	const plotW = Math.max(1, width - LABEL_WIDTH);
	const labelW = Math.max(0, width - plotW);
	const samples = plotW * 2;
	const visible = values.slice(-samples);
	const top = max ?? niceCeil(Math.max(0, ...visible), minMax);
	const levels = dotLevels(visible, samples, top, rows * 4);

	// A row's top edge sits at level (rows - r) * 4, so quarter q of the axis is the top of row rows * (1 - q/4).
	const gridRows = new Set([1, 2, 3].map(q => Math.round(rows * (1 - q / 4))).filter(r => r > 0 && r < rows));
	const labels = new Map<number, string>([
		[0, fmtCompact(top)],
		[rows - 1, '0'],
	]);
	if (rows >= 5) labels.set(Math.round(rows / 2), fmtCompact(top / 2));

	const lines: Seg[][] = [];
	for (let r = 0; r < rows; r++) {
		const base = (rows - 1 - r) * 4;
		const line = new RunBuilder();
		for (let c = 0; c < plotW; c++) {
			const bits = cellBits(levels[c * 2] ?? null, levels[c * 2 + 1] ?? null, base);
			if (bits) line.add(String.fromCharCode(BRAILLE_BASE + bits), {color, bold: true});
			else if (gridRows.has(r)) line.add(GRID_CHAR, {color: 'gray', dim: true});
			else line.add(' ', {});
		}
		line.add((labels.get(r) ?? '').padStart(labelW), {color: 'gray'});
		lines.push(line.segs);
	}
	return lines;
}

/** How many dots tall each sample column is, right-aligned (newest at the right); null = no data yet. */
function dotLevels(values: readonly number[], samples: number, top: number, dots: number): Array<number | null> {
	const levels: Array<number | null> = new Array<number | null>(Math.max(0, samples - values.length)).fill(null);
	for (const v of values) {
		// Any activity at all gets at least one dot so it stays visible.
		const level = Math.round((v / top) * dots);
		levels.push(Math.min(dots, v > 0 ? Math.max(1, level) : 0));
	}
	return levels;
}

/** Braille bits for one cell whose bottom edge is at dot level `base`. */
function cellBits(left: number | null, right: number | null, base: number): number {
	let bits = 0;
	for (let k = 0; k < 4; k++) {
		if (left != null && left - base > k) bits |= LEFT_BITS[k]!;
		if (right != null && right - base > k) bits |= RIGHT_BITS[k]!;
	}
	return bits;
}

/** Collects characters into segments, merging consecutive characters with the same style. */
class RunBuilder {
	readonly segs: Seg[] = [];
	private key = '';

	add(text: string, style: Omit<Seg, 'text'>): void {
		const key = JSON.stringify(style);
		const last = this.segs[this.segs.length - 1];
		if (last && key === this.key) last.text += text;
		else this.segs.push({text, ...style});
		this.key = key;
	}
}

/** Picks the longest title that fits alongside the current value. */
export function chartTitle(
	title: string,
	shortTitle: string | undefined,
	current: string,
	color: string,
	room: number,
): Seg[] {
	const value: Seg = {text: `(${current})`, bold: true, color};
	const fits = [title, shortTitle].find(t => t && t.length + 1 + value.text.length <= room);
	return [{text: (fits ?? shortTitle ?? title) + ' '}, value];
}
