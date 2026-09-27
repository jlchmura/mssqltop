/** Turns the cumulative counters from the OVERVIEW query into chart samples. */
import type {Row} from '../db/values.js';
import {num} from './rows.js';
import type {Series} from './types.js';

export interface Counters {
	/** Server uptime clock in ms; used as the sample timestamp so rates don't depend on query latency. */
	msTicks: number;
	cpuCount: number;
	/** Total kernel + user CPU time of every SQL Server thread. */
	cpuMs: number;
	ioBytes: number;
	batchRequests: number;
	/** Point-in-time gauge, not cumulative. */
	waitingTasks: number;
}

export interface Sample {
	cpu: number;
	waiting: number;
	io: number;
	batch: number;
}

export const emptySeries = (): Series => ({cpu: [], waiting: [], io: [], batch: []});

export function readCounters(r: Row): Counters {
	return {
		msTicks: num(r.ms_ticks),
		cpuCount: num(r.cpu_count) || 1,
		cpuMs: num(r.cpu_ms),
		ioBytes: num(r.io_bytes),
		batchRequests: num(r.batch_requests),
		waitingTasks: num(r.waiting_tasks),
	};
}

/** Rates between two counter snapshots, or null if they can't be compared (e.g. the server restarted). */
export function sampleBetween(prev: Counters, cur: Counters): Sample | null {
	const dtMs = cur.msTicks - prev.msTicks;
	if (dtMs <= 0) return null;
	const perSec = (delta: number) => clean(delta / (dtMs / 1000));
	return {
		// Threads that exit take their CPU time with them, so the delta can dip below zero.
		cpu: Math.min(100, clean(((cur.cpuMs - prev.cpuMs) / (dtMs * cur.cpuCount)) * 100)),
		waiting: clean(cur.waitingTasks),
		io: perSec((cur.ioBytes - prev.ioBytes) / 1048576),
		batch: perSec(cur.batchRequests - prev.batchRequests),
	};
}

const clean = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);

/** Appends a sample to every series, keeping at most `historySize` points. Returns a new object. */
export function appendSample(series: Series, sample: Sample, historySize: number): Series {
	const push = (arr: number[], v: number) => [...arr.slice(Math.max(0, arr.length - historySize + 1)), v];
	return {
		cpu: push(series.cpu, sample.cpu),
		waiting: push(series.waiting, sample.waiting),
		io: push(series.io, sample.io),
		batch: push(series.batch, sample.batch),
	};
}
