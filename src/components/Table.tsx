import {Box} from 'ink';
import {Line, type Seg} from './Line.js';
import {fit} from '../format.js';

export interface Column<T> {
	id: string;
	title: string;
	/** Minimum width; flex columns grow into leftover space. */
	width: number;
	flex?: number;
	align?: 'left' | 'right';
	/** Lower numbers survive longer when the terminal is narrow. */
	priority?: number;
	/** Sort key. */
	value: (row: T) => string | number | null;
	/** Display text; defaults to String(value). */
	text?: (row: T) => string;
	color?: (row: T) => string | undefined;
}

interface Laid<T> {
	col: Column<T>;
	w: number;
}

export function layoutColumns<T>(columns: Column<T>[], width: number): Laid<T>[] {
	const kept = new Set<Column<T>>();
	let used = -1;
	const byPriority = [...columns].sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
	for (const col of byPriority) {
		if (used + 1 + col.width <= width) {
			kept.add(col);
			used += 1 + col.width;
		}
	}
	const laid = columns.filter(c => kept.has(c)).map(col => ({col, w: col.width}));
	const extra = width - Math.max(0, used);
	const flexTotal = laid.reduce((n, l) => n + (l.col.flex ?? 0), 0);
	if (flexTotal > 0) {
		const flexed = laid.filter(l => l.col.flex);
		let given = 0;
		for (const l of flexed) {
			const add = Math.floor((extra * l.col.flex!) / flexTotal);
			l.w += add;
			given += add;
		}
		flexed[0]!.w += extra - given;
	}
	return laid;
}

export function sortRows<T>(rows: T[], col: Column<T> | undefined, desc: boolean, tiebreak: (row: T) => number): T[] {
	if (!col) return rows;
	const dir = desc ? -1 : 1;
	return [...rows].sort((a, b) => {
		const va = col.value(a);
		const vb = col.value(b);
		// Blanks always sink to the bottom regardless of direction.
		const ea = va === null || va === '';
		const eb = vb === null || vb === '';
		if (ea !== eb) return ea ? 1 : -1;
		let c = 0;
		if (!ea) c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
		return c * dir || tiebreak(a) - tiebreak(b);
	});
}

interface Props<T> {
	columns: Column<T>[];
	rows: T[];
	width: number;
	height: number;
	selected: number;
	offset: number;
	focused: boolean;
	sortId: string;
	sortDesc: boolean;
	emptyMessage?: string;
	rowColor?: (row: T) => string | undefined;
}

export function Table<T>({columns, rows, width, height, selected, offset, focused, sortId, sortDesc, emptyMessage, rowColor}: Props<T>) {
	const laid = layoutColumns(columns, width);
	const header: Seg[] = [];
	laid.forEach(({col, w}, i) => {
		const isSort = col.id === sortId;
		const title = isSort ? `${col.title}${sortDesc ? '▼' : '▲'}` : col.title;
		header.push({
			text: fit(title, w, col.align) + (i < laid.length - 1 ? ' ' : ''),
			color: 'black',
			bg: isSort ? 'cyan' : 'green',
			bold: isSort,
		});
	});
	const used = laid.reduce((n, l) => n + l.w, 0) + laid.length - 1;
	if (used < width) header.push({text: ' '.repeat(width - used), bg: 'green'});

	const bodyRows = Math.max(0, height - 1);
	const visible = rows.slice(offset, offset + bodyRows);

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Line segs={header} />
			{visible.length === 0 && emptyMessage ? <Line segs={[{text: fit(emptyMessage, width), color: 'gray'}]} /> : null}
			{visible.map((row, i) => {
				const cells = laid.map(({col, w}) => fit(col.text ? col.text(row) : String(col.value(row) ?? ''), w, col.align));
				if (offset + i === selected) {
					return <Line key={i} segs={[{text: fit(cells.join(' '), width), color: 'black', bg: focused ? 'cyan' : 'gray'}]} />;
				}
				const base = rowColor?.(row);
				const segs: Seg[] = cells.map((text, j) => ({
					text: j < cells.length - 1 ? text + ' ' : text,
					color: laid[j]!.col.color?.(row) ?? base,
				}));
				return <Line key={i} segs={segs} />;
			})}
		</Box>
	);
}

/** Keeps the selected row inside the viewport while moving the viewport as little as possible. */
export function scrollOffset(prev: number, selected: number, visibleRows: number, total: number): number {
	let o = prev;
	if (selected < o) o = selected;
	if (selected >= o + visibleRows) o = selected - visibleRows + 1;
	return Math.max(0, Math.min(o, Math.max(0, total - visibleRows)));
}
