import {afterEach, describe, expect, it, vi} from 'vitest';
import type {MonitorState} from '../monitor/types.js';
import {activeRow, monitorState, processRow, recentRow} from '../test/fixtures.js';
import {KEYS, renderInk, tick, type Rendered} from '../test/render.js';
import {App, type MonitorHandle} from './App.js';

/** A stand-in for Monitor whose state the test controls. */
function fakeMonitor(initial: MonitorState) {
	let state = initial;
	const listeners = new Set<() => void>();
	const monitor = {
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		getState: () => state,
		fetchSessionDetail: vi.fn(async () => ({
			currentStatement: 'SELECT 42 AS answer',
			inputBuffer: null,
			lastBatch: null,
		})),
		setPaused: vi.fn(),
		setInterval: vi.fn(),
		refreshNow: vi.fn(),
		push(patch: Partial<MonitorState>) {
			state = {...state, ...patch};
			for (const l of listeners) l();
		},
	} satisfies MonitorHandle & Record<string, unknown>;
	return monitor;
}

const loaded = monitorState({
	server: {
		name: 'DB1',
		productVersion: '16.0.1000.6',
		productLevel: 'RTM',
		edition: 'Developer Edition (64-bit)',
		cpuCount: 8,
		memoryKb: 16 * 1024 * 1024,
		startedAt: Date.now() - 60_000,
	},
	lastUpdate: Date.now(),
	series: {cpu: [10, 20], waiting: [1, 2], io: [0.5, 1], batch: [5, 6]},
	processes: [
		processRow({sessionId: 51, login: 'CORP\\alice', key: '51'}),
		processRow({
			sessionId: 52,
			login: 'CORP\\bob',
			key: '52',
			taskState: 'SUSPENDED',
			waitType: 'LCK_M_S',
			blockedBy: 51,
		}),
		processRow({sessionId: 53, login: 'CORP\\idle', key: '53', taskState: ''}),
	],
	active: [activeRow({sessionId: 51, text: 'UPDATE dbo.Orders SET x = 1'})],
	recent: [recentRow({text: 'SELECT * FROM dbo.Customers'})],
	recentReady: true,
	recentWindowSec: 60,
});

/** On Windows the app draws one row short of the terminal to avoid console flicker. */
const expectedRows = (rows: number) => (process.platform === 'win32' ? rows - 1 : rows);

let app: Rendered | undefined;
afterEach(() => app?.unmount());

function start(state = loaded, size = {columns: 140, rows: 40}) {
	const monitor = fakeMonitor(state);
	app = renderInk(<App monitor={monitor} target="db1.corp" />, size);
	return {monitor, app};
}

describe('App', () => {
	it('shows the header, the four charts and both panels', () => {
		const frame = start().app.frame();
		expect(frame).toContain('mssqltop  DB1 SQL Server 2022');
		for (const title of [
			'% Processor Time (20%)',
			'Waiting Tasks (2)',
			'Database I/O (1.00 MB/s)',
			'Batch Requests/sec (6)',
		]) {
			expect(frame).toContain(title);
		}
		expect(frame).toContain('Processes 2 of 3 sessions');
		expect(frame).toContain('Active Expensive Queries (1)');
		expect(frame).toContain('UPDATE dbo.Orders SET x = 1');
		expect(frame).toContain('?Help');
	});

	it('fills exactly the terminal height', () => {
		expect(start().app.frame().split('\n')).toHaveLength(expectedRows(40));
	});

	it('shows the target while connecting', () => {
		const frame = start(monitorState()).app.frame();
		expect(frame).toContain('connecting to db1.corp…');
		expect(frame).toContain('Connecting…');
	});

	it('re-renders when the monitor publishes new data', async () => {
		const {monitor, app} = start();
		monitor.push({processes: [processRow({sessionId: 77, login: 'CORP\\newcomer', key: '77'})]});
		await tick(10);
		expect(app.frame()).toContain('CORP\\newcomer');
	});

	it('hides idle sessions until the task filter is toggled off', async () => {
		const {app} = start();
		expect(app.frame()).not.toContain('CORP\\idle');
		await app.press('t');
		expect(app.frame()).toContain('CORP\\idle');
	});

	it('filters processes by typed text', async () => {
		const {app} = start();
		await app.press('/', 'b', 'o', 'b');
		expect(app.frame()).toContain('Filter Processes:  bob');
		await app.press(KEYS.enter);
		expect(app.frame()).toContain('Processes 1 of 3 sessions');
		expect(app.frame()).not.toContain('CORP\\alice');
	});

	it('switches to Recent Expensive Queries', async () => {
		const {app} = start();
		await app.press(KEYS.tab, 'e');
		expect(app.frame()).toContain('SELECT * FROM dbo.Customers');
		expect(app.frame()).toContain('last 60s');
	});

	it('opens session details, loads the SQL text, and closes with Esc', async () => {
		const {app, monitor} = start();
		await app.press(KEYS.down, KEYS.enter);
		expect(app.frame()).toContain('Session 52');
		expect(monitor.fetchSessionDetail).toHaveBeenCalledWith(52);
		await vi.waitFor(() => expect(app.frame()).toContain('SELECT 42 AS answer'));

		await app.press(KEYS.escape);
		expect(app.frame()).toContain('Processes 2 of 3');
	});

	it('shows an error in the detail view when the SQL text cannot be loaded', async () => {
		const {app, monitor} = start();
		monitor.fetchSessionDetail.mockRejectedValueOnce(new Error('permission denied'));
		await app.press(KEYS.enter);
		await vi.waitFor(() => expect(app.frame()).toContain('Could not load SQL text: permission denied'));
	});

	it('opens help with ?', async () => {
		const {app} = start();
		await app.press('?');
		expect(app.frame()).toContain('an htop-style take on the SSMS Activity Monitor');
	});

	it('hides the charts with c', async () => {
		const {app} = start();
		await app.press('c');
		expect(app.frame()).not.toContain('% Processor Time');
	});

	it('forwards pause, refresh and interval keys to the monitor', async () => {
		const {app, monitor} = start();
		await app.press('p', 'r', '+');
		expect(monitor.setPaused).toHaveBeenCalledWith(true);
		expect(monitor.refreshNow).toHaveBeenCalled();
		expect(monitor.setInterval).toHaveBeenCalledWith(5000);
	});

	it('quits with q', async () => {
		const {app} = start();
		const exited = app.waitUntilExit();
		await app.press('q');
		await expect(exited).resolves.toBeUndefined();
	});

	it('draws the charts with block characters by default', () => {
		const frame = start().app.frame();
		expect(frame).toMatch(/[▖▗▄▌▐▙▟█]/);
		expect(frame).not.toMatch(/[\u2801-\u28ff]/);
	});

	it('draws braille charts when asked', () => {
		const monitor = fakeMonitor(loaded);
		app = renderInk(<App monitor={monitor} target="db1" graphStyle="braille" />, {columns: 140, rows: 40});
		expect(app.frame()).toMatch(/[\u2801-\u28ff]/);
	});

	it('still renders on a small terminal', () => {
		const frame = start(loaded, {columns: 60, rows: 12}).app.frame();
		expect(frame.split('\n')).toHaveLength(expectedRows(12));
		expect(frame).not.toContain('% Processor Time');
		expect(frame).toContain('Processes');
	});
});
