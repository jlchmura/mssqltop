import {describe, expect, it} from 'vitest';
import {errorMessage, fixMojibake, isConnectionError, normalizeRow} from './values.js';

/** What the non-UNICODE odbc build hands back for `s`: its UTF-8 bytes, one per UTF-16 unit. */
const asMojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

describe('fixMojibake', () => {
	it.each(['héllo 日本 ✓', 'café', 'Zürich – naïve', '©2026 ½'])('repairs %j', real => {
		expect(fixMojibake(asMojibake(real))).toBe(real);
	});

	it.each(['plain ascii', 'café', '日本', 'Zürich'])('leaves already-correct text alone: %j', text => {
		expect(fixMojibake(text)).toBe(text);
	});

	it('leaves Latin-1 text that is not valid UTF-8 alone', () => {
		expect(fixMojibake('été')).toBe('été');
	});
});

describe('normalizeRow', () => {
	it('converts BITs, BIGINTs and mojibake, and passes other values through', () => {
		const row = {bit1: '1', bit0: '0', big: 583265460023296n, text: asMojibake('héllo'), none: null, float: 1.5};
		expect(normalizeRow(row, new Set(['bit1', 'bit0']))).toEqual({
			bit1: 1,
			bit0: 0,
			big: 583265460023296,
			text: 'héllo',
			none: null,
			float: 1.5,
		});
	});

	it('does not treat string columns that happen to be "1" as bits', () => {
		expect(normalizeRow({s: '1'}, new Set())).toEqual({s: '1'});
	});
});

const odbcError = (state: string, message: string) =>
	Object.assign(new Error('[odbc] Error'), {odbcErrors: [{state, message}]});

describe('errorMessage', () => {
	it('uses the first ODBC error and strips the driver prefixes', () => {
		const err = odbcError('42S02', "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Invalid object name 'x'.");
		expect(errorMessage(err)).toBe("Invalid object name 'x'.");
	});

	it('falls back to Error.message, or the value itself', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
		expect(errorMessage('plain')).toBe('plain');
	});

	it('collapses whitespace', () => {
		expect(errorMessage(new Error('a\n   b'))).toBe('a b');
	});
});

describe('isConnectionError', () => {
	it.each([
		['08S01', 'Communication link failure', true],
		['HY000', 'TCP Provider: Error code 0x68', true],
		['42S02', 'Invalid object name', false],
		['HYT00', 'Query timeout expired', false],
	])('state %s (%s) → %s', (state, message, expected) => {
		expect(isConnectionError(odbcError(state, message))).toBe(expected);
	});

	it('is false for non-ODBC errors', () => {
		expect(isConnectionError(new Error('x'))).toBe(false);
		expect(isConnectionError(null)).toBe(false);
	});
});
