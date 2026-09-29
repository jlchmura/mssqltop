import {Box} from 'ink';
import {DEFAULT_GRAPH_STYLE, LEVEL, chartTitle, renderChart, type ChartGradient, type GraphStyle} from '../chart.js';
import {Frame} from './Frame.js';
import {Line} from './Line.js';

interface Props {
	title: string;
	/** Used instead of `title` when the full one doesn't fit. */
	shortTitle?: string;
	/** Latest value, shown in the title. */
	current: string;
	values: readonly number[];
	width: number;
	height: number;
	/** Fixed y-axis maximum (e.g. 100 for percentages); otherwise auto-scaled. */
	max?: number;
	minMax?: number;
	/** Row colors from bottom to top. */
	gradient?: ChartGradient;
	/** Block (default) or braille characters. */
	style?: GraphStyle;
	/** Color of the current value in the title (a named color, so it suits light and dark themes). */
	color?: string;
}

/** One of the SSMS-style overview charts: a framed braille area chart. */
export function Chart({
	title,
	shortTitle,
	current,
	values,
	width,
	height,
	max,
	minMax,
	gradient = LEVEL,
	style = DEFAULT_GRAPH_STYLE,
	color = 'greenBright',
}: Props) {
	const lines = renderChart({
		values,
		width: width - 2,
		rows: Math.max(1, height - 2),
		max,
		minMax,
		gradient,
		style,
	});
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
