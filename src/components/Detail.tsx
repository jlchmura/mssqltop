import {Box} from 'ink';
import {Frame} from './Frame.js';
import {Line, type Seg} from './Line.js';
import {fit, wrap} from '../format.js';

const KEYWORDS = new Set(
	`add all alter and any as asc begin between bulk by case cast catch check close commit constraint convert create cross cursor
	deallocate declare default delete desc distinct drop else end exec execute exists fetch for foreign from full function goto
	group having if in index inner insert into is join key left like merge next not null of off on open option or order outer
	over partition percent pivot primary print proc procedure raiserror return rollback rowcount select set table then top
	tran transaction truncate try union unique update use values view waitfor when where while with apply output nolock`
		.split(/\s+/)
		.filter(Boolean),
);

type Mode = 'code' | 'string' | 'comment';

/** Tiny T-SQL highlighter: keywords, strings, comments. State carries across wrapped lines. */
export function highlightSql(lines: string[]): Seg[][] {
	let mode: Mode = 'code';
	return lines.map(line => {
		const segs: Seg[] = [];
		const push = (text: string, style: Omit<Seg, 'text'> = {}) => {
			if (text) segs.push({text, ...style});
		};
		let i = 0;
		while (i < line.length) {
			if (mode === 'comment') {
				const end = line.indexOf('*/', i);
				const stop = end === -1 ? line.length : end + 2;
				push(line.slice(i, stop), {color: 'gray'});
				if (end !== -1) mode = 'code';
				i = stop;
			} else if (mode === 'string') {
				let j = i;
				while (j < line.length) {
					if (line[j] === "'") {
						if (line[j + 1] === "'") j += 2;
						else break;
					} else j++;
				}
				push(line.slice(i, Math.min(line.length, j + 1)), {color: 'yellow'});
				if (j < line.length) mode = 'code';
				i = j + 1;
			} else if (line.startsWith('--', i)) {
				push(line.slice(i), {color: 'gray'});
				i = line.length;
			} else if (line.startsWith('/*', i)) {
				mode = 'comment';
			} else if (line[i] === "'" || line.startsWith("N'", i)) {
				const q = line[i] === 'N' ? 2 : 1;
				push(line.slice(i, i + q), {color: 'yellow'});
				i += q;
				mode = 'string';
			} else {
				const m = /^[A-Za-z_@#][\w@#$]*|^[^A-Za-z_@#'\-/]+|^./.exec(line.slice(i))!;
				const word = m[0];
				push(word, KEYWORDS.has(word.toLowerCase()) ? {color: 'blue', bold: true} : {});
				i += word.length;
			}
		}
		return segs;
	});
}

export type DetailBlock = {kind: 'fields'; fields: Array<[string, string]>} | {kind: 'sql'; title: string; text: string} | {kind: 'text'; lines: Seg[][]};

export function renderBlocks(blocks: DetailBlock[], width: number): Seg[][] {
	const out: Seg[][] = [];
	for (const block of blocks) {
		if (block.kind === 'fields') {
			const labelW = Math.max(...block.fields.map(([k]) => k.length)) + 2;
			for (const [k, v] of block.fields) {
				const wrapped = wrap(v, Math.max(10, width - labelW));
				wrapped.forEach((line, i) => out.push([{text: fit(i === 0 ? k : '', labelW), color: 'cyan'}, {text: line}]));
			}
		} else if (block.kind === 'sql') {
			out.push([]);
			const label = `── ${block.title} `;
			out.push([{text: label + '─'.repeat(Math.max(0, width - label.length)), color: 'green', bold: true}]);
			const text = block.text.replace(/^(\s*\n)+/, '').trimEnd();
			out.push(...highlightSql(wrap(text || '(none)', width)));
		} else {
			out.push(...block.lines);
		}
	}
	return out;
}

interface Props {
	title: Seg[];
	lines: Seg[][];
	width: number;
	height: number;
	offset: number;
}

export function Detail({title, lines, width, height, offset}: Props) {
	const visible = lines.slice(offset, offset + height - 2);
	return (
		<Frame width={width} height={height} title={title} focused>
			<Box flexDirection="column" paddingX={1}>
				{visible.map((segs, i) => (
					<Line key={i} segs={segs.length ? segs : [{text: ' '}]} />
				))}
			</Box>
		</Frame>
	);
}
