import {describe, expect, it} from 'vitest';
import {joinLeftRight, segWidth, truncateSegs, type Seg} from './segments.js';

const text = (segs: Seg[]) => segs.map(s => s.text).join('');

describe('segWidth', () => {
	it('sums display widths', () => {
		expect(segWidth([{text: 'ab'}, {text: '日'}])).toBe(4);
	});
});

describe('truncateSegs', () => {
	it('returns segments unchanged when they fit', () => {
		const segs = [{text: 'ab', color: 'red'}, {text: 'cd'}];
		expect(truncateSegs(segs, 4)).toEqual(segs);
	});

	it('cuts the overflowing segment with an ellipsis and keeps styles', () => {
		const out = truncateSegs([{text: 'hello', color: 'red'}, {text: ' world'}], 8);
		expect(out).toEqual([{text: 'hello', color: 'red'}, {text: ' w…'}]);
		expect(segWidth(out)).toBe(8);
	});

	it('shows an ellipsis even when a segment exactly fills the width but more follow', () => {
		expect(text(truncateSegs([{text: 'abc'}, {text: 'de'}], 3))).toBe('ab…');
	});

	it('handles a zero width', () => {
		expect(truncateSegs([{text: 'abc'}], 0)).toEqual([]);
	});
});

describe('joinLeftRight', () => {
	it('pads between the two sides to fill the width', () => {
		expect(text(joinLeftRight([{text: 'L'}], [{text: 'R'}], 10))).toBe('L        R');
	});

	it('truncates the left side first, keeping a gap', () => {
		expect(text(joinLeftRight([{text: 'abcdefghij'}], [{text: 'XYZ'}], 10))).toBe('abcde… XYZ');
	});

	it('truncates the right side when it alone is too wide', () => {
		expect(text(joinLeftRight([{text: 'left'}], [{text: 'abcdefghijkl'}], 5))).toBe('abcd…');
	});
});
