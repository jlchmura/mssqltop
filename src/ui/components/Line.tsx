import {Text} from 'ink';
import type {Seg} from '../segments.js';

/** Renders one terminal line of styled segments. Callers keep it within the width; overflow is cut. */
export function Line({segs}: {segs: readonly Seg[]}) {
	return (
		<Text wrap="truncate">
			{segs.map((s, i) => (
				<Text key={i} color={s.color} backgroundColor={s.bg} bold={s.bold} dimColor={s.dim}>
					{s.text}
				</Text>
			))}
		</Text>
	);
}
