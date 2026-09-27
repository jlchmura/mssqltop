/** Column layout, sorting and scrolling for the data grids. */

export interface Column<T> {
	id: string;
	title: string;
	/** Minimum width; flex columns grow into leftover space. */
	width: number;
	/** Share of leftover width this column receives. */
	flex?: number;
	align?: 'left' | 'right';
	/** Lower numbers survive longer when the terminal is narrow. Defaults to 5. */
	priority?: number;
	/** Sort key. Null and '' always sort last. */
	value: (row: T) => string | number | null;
	/** Display text; defaults to String(value). */
	text?: (row: T) => string;
	color?: (row: T) => string | undefined;
}

export interface LaidOutColumn<T> {
	col: Column<T>;
	width: number;
}

const COLUMN_GAP = 1;

/**
 * Chooses which columns fit in `width` (dropping the lowest-priority ones first), keeps them in
 * their declared order, and hands leftover space to the flex columns.
 */
export function layoutColumns<T>(columns: readonly Column<T>[], width: number): LaidOutColumn<T>[] {
	const kept = new Set<Column<T>>();
	let used = -COLUMN_GAP;
	for (const col of [...columns].sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))) {
		if (used + COLUMN_GAP + col.width <= width) {
			kept.add(col);
			used += COLUMN_GAP + col.width;
		}
	}
	const laid = columns.filter(c => kept.has(c)).map(col => ({col, width: col.width}));
	const flexed = laid.filter(l => l.col.flex);
	const flexTotal = flexed.reduce((n, l) => n + l.col.flex!, 0);
	const extra = width - Math.max(0, used);
	if (flexTotal > 0 && extra > 0) {
		let given = 0;
		for (const l of flexed) {
			const add = Math.floor((extra * l.col.flex!) / flexTotal);
			l.width += add;
			given += add;
		}
		flexed[0]!.width += extra - given;
	}
	return laid;
}

/** Stable sort by a column; blanks sink to the bottom in either direction, ties fall back to `tiebreak`. */
export function sortRows<T>(
	rows: readonly T[],
	col: Column<T> | undefined,
	desc: boolean,
	tiebreak: (row: T) => number = () => 0,
): T[] {
	if (!col) return [...rows];
	const dir = desc ? -1 : 1;
	return [...rows].sort((a, b) => {
		const va = col.value(a);
		const vb = col.value(b);
		const blankA = va === null || va === '';
		const blankB = vb === null || vb === '';
		if (blankA !== blankB) return blankA ? 1 : -1;
		let c = 0;
		if (!blankA) c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
		return c * dir || tiebreak(a) - tiebreak(b);
	});
}

/** Keeps the selected row inside the viewport while moving the viewport as little as possible. */
export function scrollOffset(prev: number, selected: number, visibleRows: number, total: number): number {
	let offset = prev;
	if (selected < offset) offset = selected;
	if (selected >= offset + visibleRows) offset = selected - visibleRows + 1;
	return Math.max(0, Math.min(offset, total - visibleRows));
}
