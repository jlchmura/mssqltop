import {describe, expect, it} from 'vitest';
import {parseShowplan} from '../plan/showplan.js';
import {activeRow, processRow, recentRow} from '../test/fixtures.js';
import {BATCH_PLAN, LOOKUP_PLAN} from '../test/showplans.js';
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

describe('buildOverlay: execution plans', () => {
	const loaded = (xml: string, source: 'live' | 'estimated') => ({source, xml, statements: parseShowplan(xml)});

	it('offers the plan from query details', () => {
		expect(text([buildOverlay({kind: 'active', row: activeRow()}, 100).title])).toContain('p plan');
		expect(text([buildOverlay({kind: 'recent', row: recentRow()}, 100).title])).toContain('p plan');
	});

	it('shows loading, missing and failed plans', () => {
		const row = activeRow();
		const loading = buildOverlay({kind: 'active', row, showPlan: true}, 100);
		expect(text([loading.title])).toBe('Active request · session 55 · execution plan  p details · Esc close');
		expect(text(loading.lines)).toBe('Loading plan…');
		expect(text(buildOverlay({kind: 'active', row, showPlan: true, plan: null}, 100).lines)).toContain(
			'No cached plan for this query',
		);
		expect(text(buildOverlay({kind: 'recent', row: recentRow(), showPlan: true, planError: 'boom'}, 100).lines)).toBe(
			'Could not load the plan: boom',
		);
	});

	it('draws a loaded plan, with the save hint and result', () => {
		const overlay = buildOverlay(
			{
				kind: 'active',
				row: activeRow(),
				showPlan: true,
				plan: loaded(LOOKUP_PLAN, 'live'),
				planSaved: {path: '/tmp/p.sqlplan'},
			},
			100,
		);
		expect(text([overlay.title])).toContain('s save .sqlplan');
		const body = text(overlay.lines);
		expect(body).toMatch(/^Saved to \/tmp\/p.sqlplan\n/);
		expect(body).toContain('Key Lookup (Clustered Index Seek)');
		expect(body).not.toContain('lightweight query profiling');
		expect(
			text(
				buildOverlay(
					{
						kind: 'recent',
						row: recentRow(),
						showPlan: true,
						plan: loaded(LOOKUP_PLAN, 'estimated'),
						planSaved: {error: 'EACCES'},
					},
					100,
				).lines,
			),
		).toMatch(/^Could not save the plan: EACCES/);
	});

	it('explains how to get actual rows when an active query only has its cached plan', () => {
		const body = text(
			buildOverlay({kind: 'active', row: activeRow(), showPlan: true, plan: loaded(LOOKUP_PLAN, 'estimated')}, 100)
				.lines,
		);
		expect(body).toContain('lightweight query profiling');
	});

	it('shows only the statement the query hash belongs to', () => {
		const plan = loaded(BATCH_PLAN, 'estimated');
		const body = text(
			buildOverlay({kind: 'recent', row: recentRow({key: '0xAAAAAAAAAAAAAAAA'}), showPlan: true, plan}, 100).lines,
		);
		expect(body).toContain('Table Scan  A');
		expect(body).not.toContain('Table Scan [batch]  B');
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
