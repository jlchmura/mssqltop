import type {ReactNode} from 'react';
import {Box} from 'ink';
import {segWidth, truncateSegs, type Seg} from '../segments.js';
import {Line} from './Line.js';

interface Props {
	title: readonly Seg[];
	width: number;
	height: number;
	focused?: boolean;
	children: ReactNode;
}

/** A rounded box with its title drawn into the top border, htop/SSMS-panel style. */
export function Frame({title, width, height, focused = false, children}: Props) {
	const borderColor = focused ? 'cyan' : 'gray';
	// "╭─ " + title + " " + "─…─" + "╮"
	const shown = truncateSegs(title, Math.max(0, width - 5));
	const fill = Math.max(0, width - 5 - segWidth(shown));
	const top: Seg[] = [{text: '╭─ ', color: borderColor}, ...shown, {text: ` ${'─'.repeat(fill)}╮`, color: borderColor}];
	return (
		<Box flexDirection="column" width={width} height={height} flexShrink={0}>
			<Line segs={top} />
			<Box
				borderStyle="round"
				borderTop={false}
				borderColor={borderColor}
				width={width}
				height={height - 1}
				flexDirection="column"
				overflow="hidden"
			>
				{children}
			</Box>
		</Box>
	);
}
