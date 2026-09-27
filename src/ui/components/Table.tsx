import {Box} from 'ink';
import {fit} from '../format.js';
import type {Seg} from '../segments.js';
import {layoutColumns, type Column} from '../table-model.js';
import {Line} from './Line.js';

interface Props<T> {
	columns: readonly Column<T>[];
	rows: readonly T[];
	width: number;
	/** Lines available, including the header. */
	height: number;
	selected: number;
	/** Index of the first visible row. */
	offset: number;
	focused: boolean;
	sortId: string;
	sortDesc: boolean;
	emptyMessage?: string;
}

/** A data grid: green header (sort column in cyan with ▲/▼), colored cells, highlighted selection. */
export function Table<T>({
	columns,
	rows,
	width,
	height,
	selected,
	offset,
	focused,
	sortId,
	sortDesc,
	emptyMessage,
}: Props<T>) {
	const laid = layoutColumns(columns, width);
	const gap = (i: number) => (i < laid.length - 1 ? ' ' : '');

	const header: Seg[] = laid.map(({col, width: w}, i) => {
		const isSort = col.id === sortId;
		const title = isSort ? `${col.title}${sortDesc ? '▼' : '▲'}` : col.title;
		return {text: fit(title, w, col.align) + gap(i), color: 'black', bg: isSort ? 'cyan' : 'green', bold: isSort};
	});
	const used = laid.reduce((n, l) => n + l.width, 0) + Math.max(0, laid.length - 1);
	if (used < width) header.push({text: ' '.repeat(width - used), bg: 'green'});

	const visible = rows.slice(offset, offset + Math.max(0, height - 1));
	return (
		<Box flexDirection="column" width={width} height={height}>
			<Line segs={header} />
			{visible.length === 0 && emptyMessage ? <Line segs={[{text: fit(emptyMessage, width), color: 'gray'}]} /> : null}
			{visible.map((row, i) => {
				const cells = laid.map(({col, width: w}) =>
					fit(col.text ? col.text(row) : String(col.value(row) ?? ''), w, col.align),
				);
				if (offset + i === selected) {
					return (
						<Line key={i} segs={[{text: fit(cells.join(' '), width), color: 'black', bg: focused ? 'cyan' : 'gray'}]} />
					);
				}
				return (
					<Line key={i} segs={cells.map((text, j) => ({text: text + gap(j), color: laid[j]!.col.color?.(row)}))} />
				);
			})}
		</Box>
	);
}
