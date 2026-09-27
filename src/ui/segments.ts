/** Styled text runs: the unit every line of the UI is built from. */
import {displayWidth, ellipsize, fit} from './format.js';

/** A run of identically-styled text; a line is a list of these. */
export interface Seg {
	text: string;
	color?: string | undefined;
	bg?: string | undefined;
	bold?: boolean | undefined;
	dim?: boolean | undefined;
}

export const segWidth = (segs: readonly Seg[]): number => segs.reduce((n, s) => n + displayWidth(s.text), 0);

/** Cuts a line of segments down to `w` columns, ending with an ellipsis if anything was dropped. */
export function truncateSegs(segs: readonly Seg[], w: number): Seg[] {
	if (segWidth(segs) <= w) return [...segs];
	const out: Seg[] = [];
	let remaining = w;
	for (const s of segs) {
		if (remaining <= 0) break;
		// A whole segment must leave at least one column for the ellipsis that ends the line.
		const text = displayWidth(s.text) < remaining ? s.text : ellipsize(s.text, remaining);
		out.push({...s, text});
		remaining -= displayWidth(text);
	}
	return out;
}

/** Lays out left and right segments on one line of `width`, truncating the left side (then the right) to fit. */
export function joinLeftRight(left: readonly Seg[], right: readonly Seg[], width: number): Seg[] {
	let r = [...right];
	let rightW = segWidth(r);
	if (rightW > width) {
		r = [{...r[0], text: fit(r.map(s => s.text).join(''), width)}];
		rightW = width;
	}
	const l = truncateSegs(left, Math.max(0, width - rightW - 1));
	const pad = Math.max(0, width - segWidth(l) - rightW);
	return [...l, {text: ' '.repeat(pad)}, ...r];
}
