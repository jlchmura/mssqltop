import {Box} from 'ink';
import {Frame} from './Frame.js';
import {Line, type Seg} from './Line.js';
import {fmtCompact, niceCeil} from '../format.js';

interface Props {
	title: string;
	/** Used instead of `title` when the full one doesn't fit. */
	shortTitle?: string;
	current: string;
	values: number[];
	width: number;
	height: number;
	/** Fixed y-axis maximum (e.g. 100 for percentages); otherwise auto-scaled. */
	max?: number;
	minMax?: number;
	color?: string;
}

// Braille cells are 2 dots wide × 4 tall. Bits for each column, listed bottom-up.
const LEFT_BITS = [0x40, 0x04, 0x02, 0x01];
const RIGHT_BITS = [0x80, 0x20, 0x10, 0x08];
// Not braille: many fonts draw a braille cell's unused dots faintly, which made a braille grid
// look like data. A thin dashed rule reads clearly as background.
const GRID_CHAR = '┈';

/** SSMS-style area chart drawn with braille characters, newest sample at the right edge. */
export function Chart({title, shortTitle, current, values, width, height, max, minMax = 10, color = 'greenBright'}: Props) {
	const innerW = width - 2;
	const rows = Math.max(1, height - 2);
	const plotW = Math.max(1, innerW - 6);
	const labelW = innerW - plotW;
	const samples = plotW * 2;
	const visible = values.slice(-samples);
	const top = max ?? niceCeil(Math.max(0, ...visible), minMax);
	const dots = rows * 4;
	const levels: Array<number | null> = new Array(samples - visible.length).fill(null);
	for (const v of visible) {
		const level = Math.round((v / top) * dots);
		levels.push(Math.min(dots, v > 0 ? Math.max(1, level) : 0));
	}
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
		const segs: Seg[] = [];
		let run = '';
		let runKind = '';
		const flush = () => {
			if (run) segs.push(runKind === 'data' ? {text: run, color, bold: true} : runKind === 'grid' ? {text: run, color: 'gray', dim: true} : {text: run});
			run = '';
		};
		for (let c = 0; c < plotW; c++) {
			const a = levels[c * 2];
			const b = levels[c * 2 + 1];
			let bits = 0;
			for (let k = 0; k < 4; k++) {
				if (a != null && a - base > k) bits |= LEFT_BITS[k]!;
				if (b != null && b - base > k) bits |= RIGHT_BITS[k]!;
			}
			let ch: string;
			let kind: string;
			if (bits) {
				ch = String.fromCharCode(0x2800 + bits);
				kind = 'data';
			} else if (gridRows.has(r)) {
				ch = GRID_CHAR;
				kind = 'grid';
			} else {
				ch = ' ';
				kind = 'blank';
			}
			if (kind !== runKind) flush();
			runKind = kind;
			run += ch;
		}
		flush();
		segs.push({text: (labels.get(r) ?? '').padStart(labelW), color: 'gray'});
		lines.push(segs);
	}

	return (
		<Frame width={width} height={height} title={chartTitle(title, shortTitle, current, color, width - 5)}>
			<Box flexDirection="column">
				{lines.map((segs, i) => (
					<Line key={i} segs={segs} />
				))}
			</Box>
		</Frame>
	);
}

function chartTitle(title: string, shortTitle: string | undefined, current: string, color: string, room: number): Seg[] {
	const value: Seg = {text: `(${current})`, bold: true, color};
	for (const t of [title, shortTitle]) {
		if (t && t.length + 1 + value.text.length <= room) return [{text: t + ' '}, value];
	}
	return [{text: (shortTitle ?? title) + ' '}, value];
}
