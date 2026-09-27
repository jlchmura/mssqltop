import {Box} from 'ink';
import type {Seg} from '../segments.js';
import {Frame} from './Frame.js';
import {Line} from './Line.js';

interface Props {
	title: readonly Seg[];
	lines: readonly Seg[][];
	width: number;
	height: number;
	/** First line shown. */
	offset: number;
}

/** A scrollable full-screen panel for help and row details. */
export function Detail({title, lines, width, height, offset}: Props) {
	const visible = lines.slice(offset, offset + Math.max(0, height - 2));
	return (
		<Frame width={width} height={height} title={title} focused>
			<Box flexDirection="column" paddingX={1}>
				{visible.map((segs, i) => (
					<Line key={i} segs={segs.length ? segs : [{text: ' '}]} />
				))}
			</Box>
		</Frame>
	);
}
