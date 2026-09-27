import {describe, expect, it} from 'vitest';
import type {Seg} from './segments.js';
import {highlightSql} from './sql-highlight.js';

const withColor = (line: Seg[], color: string) => line.filter(s => s.color === color).map(s => s.text);

describe('highlightSql', () => {
	it('highlights keywords case-insensitively, leaving the text intact', () => {
		const [line] = highlightSql(['select x FROM t']);
		expect(withColor(line!, 'blue')).toEqual(['select', 'FROM']);
		expect(line!.map(s => s.text).join('')).toBe('select x FROM t');
	});

	it('does not treat identifiers containing keywords as keywords', () => {
		const [line] = highlightSql(['SELECT selected, from_date FROM t']);
		expect(withColor(line!, 'blue')).toEqual(['SELECT', 'FROM']);
	});

	it('colors string literals, including doubled-quote escapes', () => {
		const [line] = highlightSql(["SELECT 'it''s' AS x"]);
		expect(withColor(line!, 'yellow').join('')).toBe("'it''s'");
		expect(withColor(line!, 'blue')).toEqual(['SELECT', 'AS']);
	});

	it('colors N-prefixed unicode literals', () => {
		const [line] = highlightSql(["N'abc'"]);
		expect(withColor(line!, 'yellow').join('')).toBe("N'abc'");
	});

	it('colors line comments to the end of the line', () => {
		const [line] = highlightSql(['x -- select this']);
		expect(withColor(line!, 'gray')).toEqual(['-- select this']);
		expect(withColor(line!, 'blue')).toEqual([]);
	});

	it('carries block comments across lines', () => {
		const [first, second] = highlightSql(['a /* one', 'two */ select']);
		expect(withColor(first!, 'gray')).toEqual(['/* one']);
		expect(withColor(second!, 'gray')).toEqual(['two */']);
		expect(withColor(second!, 'blue')).toEqual(['select']);
	});

	it('carries string literals across lines', () => {
		const [, second] = highlightSql(["'abc", "def' select"]);
		expect(withColor(second!, 'yellow')).toEqual(["def'"]);
		expect(withColor(second!, 'blue')).toEqual(['select']);
	});

	it('treats lone minus and slash as operators', () => {
		const [line] = highlightSql(['a - b / c']);
		expect(withColor(line!, 'gray')).toEqual([]);
		expect(line!.map(s => s.text).join('')).toBe('a - b / c');
	});

	it('returns an empty line for empty input', () => {
		expect(highlightSql([''])).toEqual([[]]);
	});
});
