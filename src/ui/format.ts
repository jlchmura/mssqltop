/** Text measurement and number formatting for the terminal UI. */
import stringWidth from 'string-width';

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** Terminal columns a string occupies (wide CJK characters count as 2). */
export function displayWidth(s: string): number {
	return ASCII_PRINTABLE.test(s) ? s.length : stringWidth(s);
}

/** Collapses whitespace/control characters so SQL text fits on one line. */
export function oneLine(s: string): string {
	return s.replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim();
}

/** The longest prefix of `s` that fits in `w - 1` columns, followed by an ellipsis. */
export function ellipsize(s: string, w: number): string {
	if (w <= 0) return '';
	if (ASCII_PRINTABLE.test(s)) return s.slice(0, w - 1) + '…';
	let out = '';
	let used = 0;
	for (const ch of s) {
		const cw = stringWidth(ch);
		if (used + cw > w - 1) break;
		out += ch;
		used += cw;
	}
	return out + '…';
}

/** Truncates (with an ellipsis) or pads a string to exactly `w` terminal columns. */
export function fit(s: string, w: number, align: 'left' | 'right' = 'left'): string {
	if (w <= 0) return '';
	const text = displayWidth(s) > w ? ellipsize(s, w) : s;
	const pad = ' '.repeat(Math.max(0, w - displayWidth(text)));
	return align === 'right' ? pad + text : text + pad;
}

/** Wraps text to `w` columns, preferring to break at spaces and preserving explicit line breaks. */
export function wrap(text: string, w: number): string[] {
	const out: string[] = [];
	for (const raw of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
		const line = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
		let rest = line;
		while (displayWidth(rest) > w) {
			let cut = w;
			// Break after a space in the back half of the line; the space is trimmed from the line.
			const space = rest.lastIndexOf(' ', w);
			if (space > w * 0.5) cut = space + 1;
			// For wide characters, back off until the (trimmed) slice actually fits.
			while (cut > 1 && displayWidth(rest.slice(0, cut).trimEnd()) > w) cut--;
			out.push(rest.slice(0, cut).trimEnd());
			rest = rest.slice(cut);
		}
		out.push(rest);
	}
	return out;
}

/** Integers with thousands separators; blank for null. */
export function fmtInt(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '';
	return Math.round(v).toLocaleString('en-US');
}

/** Rates: two decimals while tiny, one while small, grouped integers once large. */
export function fmtRate(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '';
	if (v === 0) return '0';
	if (Math.abs(v) < 10) return v.toFixed(2);
	if (Math.abs(v) < 100) return v.toFixed(1);
	return fmtInt(v);
}

/** Compact number for chart labels: 950, 2500, 35k, 2.1M. */
export function fmtCompact(v: number): string {
	const a = Math.abs(v);
	if (a >= 1e9) return compactUnit(v / 1e9) + 'G';
	if (a >= 1e6) return compactUnit(v / 1e6) + 'M';
	if (a >= 1e4) return compactUnit(v / 1e3) + 'k';
	if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
	return v.toFixed(1);
}

const compactUnit = (v: number) => String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

export function fmtKb(kb: number): string {
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = kb;
	let u = 0;
	while (v >= 1024 && u < units.length - 1) {
		v /= 1024;
		u++;
	}
	return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** 49d 16:52:53, or 16:52:53 under a day. */
export function fmtDuration(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(s / 86400);
	const pad = (n: number) => String(n).padStart(2, '0');
	const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
	return d ? `${d}d ${hms}` : hms;
}

/** Rounds up to 1, 2, 2.5 or 5 × 10^n so chart axes land on readable values. */
export function niceCeil(v: number, min: number): number {
	const x = Math.max(v, min);
	if (!(x > 0)) return 1;
	const mag = 10 ** Math.floor(Math.log10(x));
	const step = [1, 2, 2.5, 5].find(s => s * mag >= x) ?? 10;
	return step * mag;
}

const PRODUCT_YEARS: Record<string, string> = {
	'9': '2005',
	'10': '2008',
	'11': '2012',
	'12': '2014',
	'13': '2016',
	'14': '2017',
	'15': '2019',
	'16': '2022',
	'17': '2025',
};

/** "13.0.6404.1" + "SP3" → "SQL Server 2016 SP3". */
export function productName(version: string, level: string): string {
	const year = PRODUCT_YEARS[version.split('.')[0] ?? ''];
	const name = year ? `SQL Server ${year}` : 'SQL Server';
	return level && level !== 'RTM' ? `${name} ${level}` : name;
}
