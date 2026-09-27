import {describe, expect, it} from 'vitest';
import {monitorState} from '../test/fixtures.js';
import {FOOTER_KEYS, buildFooter, buildHeader, buildProcessesTitle, buildQueriesTitle} from './chrome.js';
import {segWidth, type Seg} from './segments.js';

const text = (segs: Seg[]) => segs.map(s => s.text).join('');
const NOW = Date.UTC(2026, 0, 2);

const server = {
	name: 'DB1',
	productVersion: '13.0.6404.1',
	productLevel: 'SP3',
	edition: 'Developer Edition (64-bit)',
	cpuCount: 128,
	memoryKb: 1024 ** 3,
	startedAt: NOW - 86_400_000,
};

describe('buildHeader', () => {
	it('describes the server and fills the width exactly', () => {
		const header = buildHeader(monitorState({server}), 'db1', 160, NOW);
		expect(text(header)).toContain(
			'DB1 SQL Server 2016 SP3 · Developer · 13.0.6404.1 · 128 CPUs · 1.0 TB · up 1d 00:00:00',
		);
		expect(segWidth(header)).toBe(160);
	});

	it('shows the target while connecting', () => {
		expect(text(buildHeader(monitorState(), 'db1.corp', 80, NOW))).toContain('connecting to db1.corp…');
	});

	it('shows the refresh interval, query time and last update', () => {
		const header = text(buildHeader(monitorState({fastQueryMs: 120, lastUpdate: NOW}), 'x', 120, NOW));
		expect(header).toContain('every 2s');
		expect(header).toContain('120ms');
		expect(header).toMatch(/\d\d:\d\d:\d\d $/);
	});

	it('flags errors and pauses on the right', () => {
		const error = buildHeader(monitorState({error: 'Login timeout expired'}), 'x', 80, NOW);
		expect(error.find(s => s.text.includes('Login timeout expired'))).toMatchObject({bg: 'red'});
		expect(text(buildHeader(monitorState({paused: true}), 'x', 80, NOW))).toContain('PAUSED');
	});
});

describe('buildFooter', () => {
	it('lists every key hint when there is room', () => {
		expect(text(buildFooter(false, '', 'processes', 200))).toContain('qQuit');
	});

	it('drops hints that do not fit', () => {
		const footer = buildFooter(false, '', 'processes', 20);
		expect(segWidth(footer)).toBeLessThanOrEqual(20);
		expect(footer.length).toBeLessThan(FOOTER_KEYS.length * 2);
	});

	it('becomes a filter prompt while typing', () => {
		expect(text(buildFooter(true, 'abc', 'recent', 80))).toContain('Filter Recent queries:  abc█');
	});
});

describe('panel titles', () => {
	const filters = {tasks: true, user: true, blocking: false, grouped: true};

	it('counts processes and lists the active filters as badges', () => {
		const title = text(buildProcessesTitle(4, 700, filters, 'sql', true));
		expect(title).toContain('Processes 4 of 700 sessions');
		expect(title).toContain(' Task State ≠ blank ');
		expect(title).toContain(' User ');
		expect(title).toContain(' /sql ');
		expect(title).not.toContain('Blocking');
	});

	it('says tasks when not grouped', () => {
		expect(text(buildProcessesTitle(1, 2, {...filters, grouped: false}, '', false))).toContain('1 of 2 tasks');
	});

	it('highlights the selected query tab and shows the recent window', () => {
		const recent = buildQueriesTitle('recent', {recent: 3, active: 7}, 42.4, '', true);
		expect(recent.find(s => s.text.includes('Recent'))).toMatchObject({bg: 'cyan'});
		expect(recent.find(s => s.text.includes('Active'))?.bg).toBeUndefined();
		expect(text(recent)).toContain('last 42s');
		expect(text(buildQueriesTitle('active', {recent: 3, active: 7}, 42, '', true))).not.toContain('last');
	});
});
