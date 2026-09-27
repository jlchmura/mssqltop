import {describe, expect, it} from 'vitest';
import {appendSample, emptySeries, readCounters, sampleBetween, type Counters} from './series.js';

const counters = (overrides: Partial<Counters> = {}): Counters => ({
	msTicks: 1000,
	cpuCount: 4,
	cpuMs: 0,
	ioBytes: 0,
	batchRequests: 100,
	waitingTasks: 0,
	...overrides,
});

describe('readCounters', () => {
	it('maps the OVERVIEW columns', () => {
		expect(
			readCounters({ms_ticks: 5, cpu_count: 8, cpu_ms: 10, io_bytes: 20, batch_requests: 30, waiting_tasks: 2}),
		).toEqual({msTicks: 5, cpuCount: 8, cpuMs: 10, ioBytes: 20, batchRequests: 30, waitingTasks: 2});
	});

	it('never reports zero CPUs (it is a divisor)', () => {
		expect(readCounters({cpu_count: 0}).cpuCount).toBe(1);
	});
});

describe('sampleBetween', () => {
	it('turns counter deltas into rates over the server-side elapsed time', () => {
		const prev = counters();
		const cur = counters({msTicks: 3000, cpuMs: 2000, ioBytes: 4 * 1048576, batchRequests: 140, waitingTasks: 7});
		// 2s elapsed on 4 CPUs = 8000 CPU-ms available; 2000 used = 25%.
		expect(sampleBetween(prev, cur)).toEqual({cpu: 25, waiting: 7, io: 2, batch: 20});
	});

	it('returns null when the clock did not advance (or the server restarted)', () => {
		expect(sampleBetween(counters({msTicks: 5000}), counters({msTicks: 5000}))).toBeNull();
		expect(sampleBetween(counters({msTicks: 5000}), counters({msTicks: 10}))).toBeNull();
	});

	it('clamps CPU to 0–100%', () => {
		expect(sampleBetween(counters({cpuMs: 500}), counters({msTicks: 2000, cpuMs: 0}))?.cpu).toBe(0);
		expect(sampleBetween(counters(), counters({msTicks: 2000, cpuMs: 1e9}))?.cpu).toBe(100);
	});

	it('never reports negative rates when a counter resets', () => {
		const sample = sampleBetween(counters({ioBytes: 1e9, batchRequests: 1e6}), counters({msTicks: 2000}));
		expect(sample).toMatchObject({io: 0, batch: 0});
	});
});

describe('appendSample', () => {
	const sample = {cpu: 1, waiting: 2, io: 3, batch: 4};

	it('appends to every series without mutating the input', () => {
		const before = emptySeries();
		const after = appendSample(before, sample, 10);
		expect(after).toEqual({cpu: [1], waiting: [2], io: [3], batch: [4]});
		expect(before).toEqual(emptySeries());
	});

	it('keeps at most historySize points, dropping the oldest', () => {
		let series = emptySeries();
		for (let i = 1; i <= 5; i++) series = appendSample(series, {...sample, cpu: i}, 3);
		expect(series.cpu).toEqual([3, 4, 5]);
	});
});
