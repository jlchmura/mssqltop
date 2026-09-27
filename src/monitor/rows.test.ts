import {describe, expect, it} from 'vitest';
import {RateTracker, activeKey, toActiveRow, toProcessRow, toServerInfo} from './rows.js';

describe('toServerInfo', () => {
	it('maps SERVER_INFO and converts uptime into a start time', () => {
		const info = toServerInfo(
			{
				server_name: 'DB1',
				product_version: '16.0.1000.6',
				product_level: 'RTM',
				edition: 'Developer Edition (64-bit)',
				cpu_count: 8,
				physical_memory_kb: 1024,
				uptime_s: 60,
			},
			100_000,
		);
		expect(info).toEqual({
			name: 'DB1',
			productVersion: '16.0.1000.6',
			productLevel: 'RTM',
			edition: 'Developer Edition (64-bit)',
			cpuCount: 8,
			memoryKb: 1024,
			startedAt: 40_000,
		});
	});
});

describe('toProcessRow', () => {
	it('maps PROCESSES columns, turning NULLs into blanks or nulls', () => {
		const row = toProcessRow(
			{
				session_id: 55,
				is_user_process: 1,
				login_name: 'CORP\\alice',
				task_state: 'RUNNING',
				wait_duration_ms: null,
				blocked_by: 60,
				head_blocker: 0,
				request_id: 0,
				exec_context_id: 2,
				program_name: null,
			},
			7,
		);
		expect(row).toMatchObject({
			key: '55:0:2:7',
			sessionId: 55,
			userProcess: true,
			login: 'CORP\\alice',
			taskState: 'RUNNING',
			waitTimeMs: null,
			blockedBy: 60,
			headBlocker: false,
			application: '',
			tasks: 1,
		});
	});

	it('treats anything but 1 as a system process', () => {
		expect(toProcessRow({session_id: 1, is_user_process: 0}, 0).userProcess).toBe(false);
	});
});

describe('toActiveRow', () => {
	it('maps ACTIVE_QUERIES columns and keys requests by session, request and start time', () => {
		const raw = {
			session_id: 70,
			request_id: 0,
			start_time: '2026-01-01 10:00:00.000',
			cpu_time: 1500,
			granted_memory_kb: null,
			statement_text: 'SELECT 1',
		};
		expect(activeKey(raw)).toBe('70:0:2026-01-01 10:00:00.000');
		expect(toActiveRow(raw, 250)).toMatchObject({
			key: '70:0:2026-01-01 10:00:00.000',
			sessionId: 70,
			cpuMs: 1500,
			cpuMsPerSec: 250,
			grantedKb: null,
			text: 'SELECT 1',
		});
	});
});

describe('RateTracker', () => {
	it('returns null on first sighting, then a per-second rate', () => {
		const t = new RateTracker();
		expect(t.next([['a', 100]], 0).get('a')).toBeNull();
		expect(t.next([['a', 600]], 1000).get('a')).toBe(500);
		expect(t.next([['a', 700]], 1500).get('a')).toBe(200);
	});

	it('never returns a negative rate', () => {
		const t = new RateTracker();
		t.next([['a', 100]], 0);
		expect(t.next([['a', 50]], 1000).get('a')).toBe(0);
	});

	it('forgets keys that disappear, so a reused key starts over', () => {
		const t = new RateTracker();
		t.next([['a', 100]], 0);
		t.next([['b', 1]], 1000);
		expect(t.next([['a', 900]], 2000).get('a')).toBeNull();
	});
});
