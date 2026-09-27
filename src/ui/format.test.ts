import {describe, expect, it} from 'vitest';
import {
	displayWidth,
	fit,
	fmtCompact,
	fmtDuration,
	fmtInt,
	fmtKb,
	fmtRate,
	niceCeil,
	oneLine,
	productName,
	wrap,
} from './format.js';

describe('displayWidth', () => {
	it('counts ASCII characters one column each', () => {
		expect(displayWidth('abc')).toBe(3);
	});

	it('counts wide CJK characters as two columns', () => {
		expect(displayWidth('日本')).toBe(4);
	});
});

describe('fit', () => {
	it('pads short text on the right by default', () => {
		expect(fit('ab', 5)).toBe('ab   ');
	});

	it('right-aligns', () => {
		expect(fit('ab', 5, 'right')).toBe('   ab');
	});

	it('leaves text that exactly fits alone', () => {
		expect(fit('abcd', 4)).toBe('abcd');
	});

	it('truncates with an ellipsis', () => {
		expect(fit('abcdef', 4)).toBe('abc…');
	});

	it('truncates wide characters by display width', () => {
		const out = fit('日本語テキスト', 7);
		expect(out).toBe('日本語…');
		expect(displayWidth(out)).toBe(7);
	});

	it('pads when a wide character cannot fill the last column', () => {
		const out = fit('日本語', 4);
		expect(out).toBe('日… ');
		expect(displayWidth(out)).toBe(4);
	});

	it('returns an empty string for non-positive widths', () => {
		expect(fit('abc', 0)).toBe('');
		expect(fit('abc', -3)).toBe('');
	});
});

describe('oneLine', () => {
	it('collapses newlines, tabs and runs of spaces', () => {
		expect(oneLine('SELECT\n\t1\r\n  FROM   t  ')).toBe('SELECT 1 FROM t');
	});
});

describe('wrap', () => {
	it('breaks at spaces when possible', () => {
		expect(wrap('hello world foo', 11)).toEqual(['hello world', 'foo']);
	});

	it('hard-breaks words longer than the width', () => {
		expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
	});

	it('preserves explicit and blank lines, including CRLF', () => {
		expect(wrap('a\r\n\nb', 10)).toEqual(['a', '', 'b']);
	});

	it('expands tabs and strips control characters', () => {
		expect(wrap('\tx\x07', 20)).toEqual(['    x']);
	});

	it('never produces lines wider than the limit for wide characters', () => {
		for (const line of wrap('日本語のテキストです', 5)) expect(displayWidth(line)).toBeLessThanOrEqual(5);
	});
});

describe('number formatting', () => {
	it.each([
		[1234567, '1,234,567'],
		[2.6, '3'],
		[null, ''],
		[Number.NaN, ''],
	])('fmtInt(%s) = %j', (v, expected) => {
		expect(fmtInt(v)).toBe(expected);
	});

	it.each([
		[0, '0'],
		[1.234, '1.23'],
		[12.34, '12.3'],
		[1234.5, '1,235'],
		[null, ''],
	])('fmtRate(%s) = %j', (v, expected) => {
		expect(fmtRate(v)).toBe(expected);
	});

	it.each([
		[7, '7'],
		[12.5, '12.5'],
		[950, '950'],
		[2500, '2500'],
		[12_500, '12.5k'],
		[250_000, '250k'],
		[2_100_000, '2.1M'],
		[3e9, '3G'],
	])('fmtCompact(%s) = %j', (v, expected) => {
		expect(fmtCompact(v)).toBe(expected);
	});

	it.each([
		[512, '512 KB'],
		[1536, '1.5 MB'],
		[1_073_295_532, '1024 GB'],
		[2 * 1024 ** 3, '2.0 TB'],
	])('fmtKb(%s) = %j', (kb, expected) => {
		expect(fmtKb(kb)).toBe(expected);
	});

	it.each([
		[0, '00:00:00'],
		[3_723_000, '01:02:03'],
		[90_061_000, '1d 01:01:01'],
		[-5000, '00:00:00'],
	])('fmtDuration(%s) = %j', (ms, expected) => {
		expect(fmtDuration(ms)).toBe(expected);
	});
});

describe('niceCeil', () => {
	it.each([
		[7, 10, 10],
		[11, 10, 20],
		[21, 10, 25],
		[26, 10, 50],
		[51, 10, 100],
		[1000, 10, 1000],
		[1001, 10, 2000],
		[0, 1, 1],
		[0, 0, 1],
	])('niceCeil(%s, min %s) = %s', (v, min, expected) => {
		expect(niceCeil(v, min)).toBe(expected);
	});

	it('handles fractional ranges', () => {
		expect(niceCeil(0.3, 0.1)).toBeCloseTo(0.5);
	});
});

describe('productName', () => {
	it('maps the major version to a release year and appends the service pack', () => {
		expect(productName('13.0.6404.1', 'SP3')).toBe('SQL Server 2016 SP3');
	});

	it('omits RTM', () => {
		expect(productName('16.0.1000.6', 'RTM')).toBe('SQL Server 2022');
	});

	it('falls back for unknown versions', () => {
		expect(productName('99.0.1.1', '')).toBe('SQL Server');
	});
});
