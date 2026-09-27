import {Text} from 'ink';

/** A run of identically-styled text; a line is a list of these. */
export interface Seg {
	text: string;
	color?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
}

export const segWidth = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.text].length, 0);

/** Cuts a line of segments down to `w` columns, ending with an ellipsis if anything was dropped. */
export function truncateSegs(segs: Seg[], w: number): Seg[] {
	if (segWidth(segs) <= w) return segs;
	const out: Seg[] = [];
	let remaining = w;
	for (const s of segs) {
		if (remaining <= 0) break;
		const chars = [...s.text];
		// Whole segments must leave at least one column for the ellipsis that ends the line.
		const text = chars.length < remaining ? s.text : chars.slice(0, remaining - 1).join('') + '…';
		out.push({...s, text});
		remaining -= [...text].length;
	}
	return out;
}

/** Renders one terminal line. Callers are responsible for keeping it within the width. */
export function Line({segs, bg}: {segs: Seg[]; bg?: string}) {
	return (
		<Text wrap="truncate" backgroundColor={bg}>
			{segs.map((s, i) => (
				<Text key={i} color={s.color} backgroundColor={s.bg} bold={s.bold} dimColor={s.dim}>
					{s.text}
				</Text>
			))}
		</Text>
	);
}
