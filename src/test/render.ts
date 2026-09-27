/**
 * Renders Ink trees into a fake terminal of a fixed size, so tests don't depend on the real one.
 * (ink-testing-library hardcodes 100 columns and no row count.)
 */
import {EventEmitter} from 'node:events';
import type {ReactElement} from 'react';
import {render as inkRender} from 'ink';

class FakeStdout extends EventEmitter {
	lastFrame = '';
	constructor(
		readonly columns: number,
		readonly rows: number,
	) {
		super();
	}
	write = (frame: string): boolean => {
		this.lastFrame = frame;
		return true;
	};
}

class FakeStdin extends EventEmitter {
	isTTY = true;
	private data: string | null = null;
	write(data: string): void {
		this.data = data;
		this.emit('readable');
		this.emit('data', data);
	}
	read = (): string | null => {
		const {data} = this;
		this.data = null;
		return data;
	};
	setEncoding(): void {}
	setRawMode(): void {}
	resume(): void {}
	pause(): void {}
	ref(): void {}
	unref(): void {}
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export interface Rendered {
	/** The most recent frame as plain text. */
	frame(): string;
	/** Sends keystrokes, then waits for React to re-render. */
	press(...keys: string[]): Promise<void>;
	/** Resolves when the app exits (e.g. via useApp().exit()). */
	waitUntilExit(): Promise<unknown>;
	unmount(): void;
}

export const KEYS = {
	up: '\x1b[A',
	down: '\x1b[B',
	right: '\x1b[C',
	left: '\x1b[D',
	enter: '\r',
	escape: '\x1b',
	tab: '\t',
	backspace: '\x7f',
} as const;

export const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function renderInk(tree: ReactElement, {columns = 120, rows = 40} = {}): Rendered {
	const stdout = new FakeStdout(columns, rows);
	const stdin = new FakeStdin();
	const instance = inkRender(tree, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
		stdin: stdin as unknown as NodeJS.ReadStream,
		debug: true,
		exitOnCtrlC: false,
		patchConsole: false,
	});
	return {
		frame: () => stdout.lastFrame.replace(ANSI, ''),
		async press(...keys) {
			for (const key of keys) {
				stdin.write(key);
				// Escape is ambiguous (it may start a sequence), so Ink waits briefly before emitting it.
				await tick(key === KEYS.escape ? 60 : 5);
			}
		},
		waitUntilExit: () => instance.waitUntilExit(),
		unmount: () => instance.unmount(),
	};
}
