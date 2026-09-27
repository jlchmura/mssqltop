import React from 'react';
import {Box} from 'ink';
import {Line, segWidth, truncateSegs, type Seg} from './Line.js';

interface Props {
	title: Seg[];
	width: number;
	height: number;
	focused?: boolean;
	children: React.ReactNode;
}

/** A rounded box with the title drawn into its top border, htop/SSMS-panel style. */
export function Frame({title, width, height, focused, children}: Props) {
	const borderColor = focused ? 'cyan' : 'gray';
	const shown = truncateSegs(title, Math.max(0, width - 5));
	const fill = width - 5 - segWidth(shown);
	const top: Seg[] = [{text: '╭─ ', color: borderColor}, ...shown, {text: ' ' + '─'.repeat(fill) + '╮', color: borderColor}];
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
