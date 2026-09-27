import {afterEach, describe, expect, it} from 'vitest';
import {renderInk, type Rendered} from '../../test/render.js';
import type {Column} from '../table-model.js';
import {Chart} from './Chart.js';
import {Detail} from './Detail.js';
import {Frame} from './Frame.js';
import {Table} from './Table.js';

let rendered: Rendered | undefined;
afterEach(() => rendered?.unmount());
const show = (...args: Parameters<typeof renderInk>) => (rendered = renderInk(...args)).frame().split('\n');

describe('Frame', () => {
	it('draws the title into the top border at exactly the frame width', () => {
		const [top, , bottom] = show(
			<Frame title={[{text: 'Title'}]} width={20} height={3}>
				<></>
			</Frame>,
		);
		expect(top).toBe('╭─ Title ──────────╮');
		expect(bottom).toBe('╰──────────────────╯');
	});

	it('truncates titles that do not fit', () => {
		const [top] = show(
			<Frame title={[{text: 'A very long title indeed'}]} width={16} height={3}>
				<></>
			</Frame>,
		);
		expect(top).toBe('╭─ A very lon… ╮');
	});
});

describe('Table', () => {
	interface Row {
		key: string;
		name: string;
		n: number;
	}
	const columns: Column<Row>[] = [
		{id: 'name', title: 'Name', width: 6, flex: 1, value: r => r.name},
		{id: 'n', title: 'N', width: 4, align: 'right', value: r => r.n},
	];
	const rows: Row[] = ['alpha', 'beta', 'gamma', 'delta'].map((name, i) => ({key: name, name, n: i}));
	const table = (props: Partial<Parameters<typeof Table<Row>>[0]> = {}) => (
		<Table<Row>
			columns={columns}
			rows={rows}
			width={16}
			height={4}
			selected={0}
			offset={0}
			focused
			sortId="n"
			sortDesc
			{...props}
		/>
	);

	it('renders a header with the sort indicator and the visible rows', () => {
		expect(show(table())).toEqual(['Name          N▼', 'alpha          0', 'beta           1', 'gamma          2']);
	});

	it('starts at the scroll offset', () => {
		expect(show(table({offset: 2}))[1]).toBe('gamma          2');
	});

	it('shows a message when there are no rows', () => {
		expect(show(table({rows: [], emptyMessage: 'Nothing here'}))[1]).toBe('Nothing here');
	});
});

describe('Chart', () => {
	it('frames a braille chart with its current value and axis labels', () => {
		const lines = show(
			<Chart title="% Processor Time" current="12%" values={[50, 100]} max={100} width={30} height={5} />,
		);
		expect(lines[0]).toBe('╭─ % Processor Time (12%) ───╮');
		expect(lines[1]).toMatch(/100│$/);
		expect(lines[3]).toMatch(/0│$/);
		expect(lines.join('')).toMatch(/[⠁-⣿]/);
	});

	it('switches to the short title when narrow', () => {
		expect(
			show(
				<Chart title="Batch Requests/sec" shortTitle="Batches/s" current="18" values={[]} width={20} height={4} />,
			)[0],
		).toBe('╭─ Batches/s (18) ─╮');
	});
});

describe('Detail', () => {
	it('shows the lines from the scroll offset that fit inside the frame', () => {
		const lines = Array.from({length: 10}, (_, i) => [{text: `line ${i}`}]);
		const out = show(<Detail title={[{text: 'Help'}]} lines={lines} width={20} height={5} offset={3} />);
		expect(out.slice(1, 4).map(l => l.slice(2, 8))).toEqual(['line 3', 'line 4', 'line 5']);
	});
});
