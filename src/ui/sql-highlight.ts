/** A tiny T-SQL highlighter for the detail view: keywords, string literals and comments. */
import type {Seg} from './segments.js';

const KEYWORDS = new Set(
	`add all alter and any apply as asc begin between bulk by case cast catch check close commit constraint convert
	create cross cursor deallocate declare default delete desc distinct drop else end exec execute exists fetch for
	foreign from full function goto group having if in index inner insert into is join key left like merge next nolock
	not null of off on open option or order outer output over partition percent pivot primary print proc procedure
	raiserror return rollback rowcount select set table then top tran transaction truncate try union unique update
	use values view waitfor when where while with`.split(/\s+/),
);

type Mode = 'code' | 'string' | 'comment';

const WORD = /^[A-Za-z_@#][\w@#$]*/;
const OTHER = /^[^A-Za-z_@#'\-/]+/;

/**
 * Highlights already-wrapped lines. Block comments and string literals may span lines,
 * so the scanner's state carries from one line to the next.
 */
export function highlightSql(lines: readonly string[]): Seg[][] {
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
				const end = closingQuote(line, i);
				push(line.slice(i, end === -1 ? line.length : end + 1), {color: 'yellow'});
				if (end !== -1) mode = 'code';
				i = end === -1 ? line.length : end + 1;
			} else if (line.startsWith('--', i)) {
				push(line.slice(i), {color: 'gray'});
				i = line.length;
			} else if (line.startsWith('/*', i)) {
				mode = 'comment';
			} else if (line[i] === "'" || line.startsWith("N'", i)) {
				const quote = line[i] === 'N' ? 2 : 1;
				push(line.slice(i, i + quote), {color: 'yellow'});
				i += quote;
				mode = 'string';
			} else {
				const rest = line.slice(i);
				const token = (WORD.exec(rest) ?? OTHER.exec(rest) ?? [rest[0]!])[0];
				push(token, KEYWORDS.has(token.toLowerCase()) ? {color: 'blue', bold: true} : {});
				i += token.length;
			}
		}
		return segs;
	});
}

/** Index of the quote ending a string literal that starts at `from`, skipping doubled '' escapes; -1 if none. */
function closingQuote(line: string, from: number): number {
	for (let j = from; j < line.length; j++) {
		if (line[j] !== "'") continue;
		if (line[j + 1] === "'") j++;
		else return j;
	}
	return -1;
}
