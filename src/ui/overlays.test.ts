import {describe, expect, it} from 'vitest';
import {activeRow, processRow, recentRow} from '../test/fixtures.js';
import {HELP, buildOverlay, renderBlocks, sessionSqlBlocks} from './overlays.js';
import type {Seg} from './segments.js';

const text = (lines: Seg[][]) => lines.map(l => l.map(s => s.text).join('')).join('\n');

describe('buildOverlay', () => {
	it('help lists every key binding', () => {
		const help = text(buildOverlay({kind: 'help'}, 100).lines);
		for (const [keys] of HELP) expect(help).toContain(keys);
	});

	it('process details show fields, then load SQL text', () => {
		const loading = buildOverlay({kind: 'process', row: processRow({sessionId: 55, waitResource: 'KEY: 5:123'})}, 100);
		expect(text([loading.title])).toContain('Session 55');
		expect(text(loading.lines)).toContain('Wait Resource       KEY: 5:123');
		expect(text(loading.lines)).toContain('Loading SQL text…');

		const loaded = buildOverlay(
			{
				kind: 'process',
				row: processRow(),
				detail: {currentStatement: 'SELECT 1', inputBuffer: 'EXEC dbo.p', lastBatch: 'EXEC   dbo.p'},
			},
			100,
		);
		expect(text(loaded.lines)).toContain('── Current statement');
		expect(text(loaded.lines)).toContain('── Input buffer');
		expect(text(loaded.lines)).not.toContain('Most recent batch');
	});

	it('active details include the statement but not a duplicate current statement', () => {
		const overlay = buildOverlay(
			{
				kind: 'active',
				row: activeRow({text: 'SELECT 42', grantedKb: 2048}),
				detail: {currentStatement: 'X', inputBuffer: null, lastBatch: null},
			},
			100,
		);
		const body = text(overlay.lines);
		expect(body).toContain('SELECT 42');
		expect(body).toContain('Memory Granted           2,048 KB');
		expect(body).not.toContain('Current statement');
		expect(body).toContain('No SQL text available');
	});

	it('recent details show the query hash, or explain its absence', () => {
		expect(text(buildOverlay({kind: 'recent', row: recentRow({key: '0x1234567890ABCDEF'})}, 100).lines)).toContain(
			'Query Hash           0x1234567890ABCDEF',
		);
		expect(text(buildOverlay({kind: 'recent', row: recentRow({key: '0x0200abc:120'})}, 100).lines)).toContain(
			'(none — grouped by statement)',
		);
	});
});

describe('sessionSqlBlocks', () => {
	it('reports errors', () => {
		expect(text(renderBlocks(sessionSqlBlocks(undefined, 'boom'), 80))).toContain('Could not load SQL text: boom');
	});

	it('shows the most recent batch when it differs from the input buffer', () => {
		const blocks = sessionSqlBlocks({currentStatement: null, inputBuffer: 'EXEC a', lastBatch: 'EXEC b'}, undefined);
		expect(blocks.map(b => (b.kind === 'sql' ? b.title : b.kind))).toEqual(['Input buffer', 'Most recent batch']);
	});
});

describe('renderBlocks', () => {
	it('wraps long field values under their value column', () => {
		const lines = renderBlocks([{kind: 'fields', fields: [['Name', 'aaaa bbbb cccc dddd']]}], 16).map(l =>
			l.map(s => s.text).join(''),
		);
		expect(lines).toEqual(['Name  aaaa bbbb', '      cccc dddd']);
	});

	it('trims blank lines around SQL and marks missing text', () => {
		const lines = renderBlocks([{kind: 'sql', title: 'Q', text: '\n\n  SELECT 1\n\n'}], 20).map(l =>
			l.map(s => s.text).join(''),
		);
		expect(lines).toEqual(['', '── Q ───────────────', '  SELECT 1']);
		expect(text(renderBlocks([{kind: 'sql', title: 'Q', text: '   '}], 20))).toContain('(none)');
	});
});
