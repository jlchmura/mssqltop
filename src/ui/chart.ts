/**
 * Renders a series as an area chart, btop style. Each character is two samples wide; each sample is drawn with
 * up to 4 levels per character in braille (2×4 dots) or 2 levels in block quadrants (2×2).
 */
import {fmtCompact, niceCeil} from './format.js';
import type {Seg} from './segments.js';

/**
 * block: 2×2 quadrant blocks per character. Renders the same in practically every terminal and font.
 * braille: 2×4 dots per character, twice the vertical detail, but it depends on the terminal's braille font:
 * some draw unset dots as rings (macOS's Apple Braille fallback) or leave gaps between rows.
 */
export type GraphStyle = 'block' | 'braille';
export const GRAPH_STYLES: readonly GraphStyle[] = ['block', 'braille'];
/** Block is the default because braille is only as good as the terminal's braille font. */
export const DEFAULT_GRAPH_STYLE: GraphStyle = 'block';

// Bits for each dot column of a braille cell, listed bottom-up.
const LEFT_BITS = [0x40, 0x04, 0x02, 0x01] as const;
const RIGHT_BITS = [0x80, 0x20, 0x10, 0x08] as const;
const BRAILLE_BASE = 0x2800;
// btop's block_up table, indexed by left * 5 + right, where each side is filled 0–4 levels (quarter heights).
// prettier-ignore
const BLOCK_UP = [
	' ', '▗', '▗', '▐', '▐',
	'▖', '▄', '▄', '▟', '▟',
	'▖', '▄', '▄', '▟', '▟',
	'▌', '▙', '▙', '█', '█',
	'▌', '▙', '▙', '█', '█',
] as const;
// Not braille: many fonts draw a braille cell's unused dots faintly, which made a braille grid
// look like data. A thin dashed rule reads clearly as background.
const GRID_CHAR = '┈';
/** Room for the y-axis labels at the right edge of the plot. */
export const LABEL_WIDTH = 6;

/**
 * Gradient stops from the bottom of the chart to the top; each row gets one color interpolated along it,
 * like btop. Shading by height makes levels easy to read, even in fonts that draw every braille dot
 * position (unset ones as faint outlines).
 */
export type ChartGradient = readonly string[];

export const GREEN: ChartGradient = ['#2f7d3f', '#5fd16f', '#b4f5b0'];

export interface ChartSpec {
	/** The most recent samples, oldest first. */
	values: readonly number[];
	/** Width in columns, including the label area. */
	width: number;
	rows: number;
	/** Fixed y-axis maximum (e.g. 100 for percentages); otherwise auto-scaled from the visible values. */
	max?: number | undefined;
	/** Smallest auto-scaled maximum, so a quiet server doesn't magnify noise. */
	minMax?: number | undefined;
	gradient?: ChartGradient | undefined;
	style?: GraphStyle | undefined;
}

/**
 * The chart as lines of segments: plot on the left, y-axis labels (max, mid, 0) on the right.
 *
 * Works like btop's graphs: each sample is one dot column, two per character, and the newest sample is always
 * the right-hand column of the last character. Every refresh the whole chart slides left by one dot.
 */
export function renderChart({
	values,
	width,
	rows,
	max,
	minMax = 10,
	gradient = GREEN,
	style = DEFAULT_GRAPH_STYLE,
}: ChartSpec): Seg[][] {
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
		const color = gradientAt(gradient, rows > 1 ? (rows - 1 - r) / (rows - 1) : 1);
		const line = new RunBuilder();
		for (let c = 0; c < plotW; c++) {
			const left = fillWithin(levels[c * 2] ?? null, base);
			const right = fillWithin(levels[c * 2 + 1] ?? null, base);
			if (left || right) line.add(glyph(style, left, right), {color});
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

/** The color `t` (0–1) of the way along the gradient; hex stops are interpolated, anything else is picked. */
export function gradientAt(stops: ChartGradient, t: number): string {
	if (stops.length === 0) return 'green';
	const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
	const i = Math.min(stops.length - 2, Math.floor(x));
	if (i < 0) return stops[0]!;
	const [a, b] = [parseHex(stops[i]!), parseHex(stops[i + 1]!)];
	if (!a || !b) return stops[Math.round(x)]!;
	const f = x - i;
	return (
		'#' +
		a
			.map((v, k) =>
				Math.round(v + (b[k]! - v) * f)
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	);
}

const parseHex = (color: string): number[] | null =>
	/^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : null;

/** How many of a character's 4 levels a sample fills, for the character whose bottom edge is at level `base`. */
const fillWithin = (level: number | null, base: number): number =>
	level == null ? 0 : Math.max(0, Math.min(4, level - base));

/** The character showing a left and right sample filled 0–4 levels each. */
function glyph(style: GraphStyle, left: number, right: number): string {
	if (style === 'block') return BLOCK_UP[left * 5 + right]!;
	let bits = 0;
	for (let k = 0; k < 4; k++) {
		if (left > k) bits |= LEFT_BITS[k]!;
		if (right > k) bits |= RIGHT_BITS[k]!;
	}
	return String.fromCharCode(BRAILLE_BASE + bits);
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
