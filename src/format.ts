import stringWidth from 'string-width';

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

const width = (s: string) => (ASCII_PRINTABLE.test(s) ? s.length : stringWidth(s));

/** Collapses whitespace/control characters so SQL text fits on one line. */
export function oneLine(s: string): string {
	return s.replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim();
}

/** Truncates (with an ellipsis) or pads a string to exactly `w` terminal columns. */
export function fit(s: string, w: number, align: 'left' | 'right' = 'left'): string {
	if (w <= 0) return '';
	let text = s;
	let tw = width(text);
	if (tw > w) {
		if (ASCII_PRINTABLE.test(text)) {
			text = text.slice(0, w - 1) + '…';
		} else {
			let out = '';
			let ow = 0;
			for (const ch of text) {
				const cw = stringWidth(ch);
				if (ow + cw > w - 1) break;
				out += ch;
				ow += cw;
			}
			text = out + '…';
		}
		tw = width(text);
	}
	const pad = ' '.repeat(Math.max(0, w - tw));
	return align === 'right' ? pad + text : text + pad;
}

export function fmtInt(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '';
	return Math.round(v).toLocaleString('en-US');
}

/** Rates: one decimal while small, grouped integers once large. */
export function fmtRate(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '';
	if (v === 0) return '0';
	if (Math.abs(v) < 10) return v.toFixed(2);
	if (Math.abs(v) < 100) return v.toFixed(1);
	return fmtInt(v);
}

/** Compact number for chart labels: 950, 1.2k, 35k, 2.1M. */
export function fmtCompact(v: number): string {
	const a = Math.abs(v);
	if (a >= 1e9) return trim(v / 1e9) + 'G';
	if (a >= 1e6) return trim(v / 1e6) + 'M';
	if (a >= 1e4) return trim(v / 1e3) + 'k';
	if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
	return v.toFixed(1);
}

function trim(v: number): string {
	return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString();
}

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

export function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return d ? `${d}d ${hms}` : hms;
}

/** Rounds up to 1, 2, 2.5 or 5 × 10^n so chart axes land on readable values. */
export function niceCeil(v: number, min: number): number {
	const x = Math.max(v, min);
	const mag = 10 ** Math.floor(Math.log10(x));
	for (const step of [1, 2, 2.5, 5, 10]) {
		if (step * mag >= x) return step * mag;
	}
	return 10 * mag;
}

const PRODUCT_NAMES: Record<string, string> = {
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

export function productName(version: string, level: string): string {
	const major = version.split('.')[0] ?? '';
	const name = PRODUCT_NAMES[major] ? `SQL Server ${PRODUCT_NAMES[major]}` : 'SQL Server';
	return level && level !== 'RTM' ? `${name} ${level}` : name;
}

/** Wraps text to `w` columns, preserving explicit line breaks. */
export function wrap(text: string, w: number): string[] {
	const out: string[] = [];
	for (const raw of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
		const line = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
		if (line.length === 0) {
			out.push('');
			continue;
		}
		let rest = line;
		while (width(rest) > w) {
			let cut = w;
			const space = rest.lastIndexOf(' ', w);
			if (space > w * 0.5) cut = space + 1;
			// For non-ASCII text, back off until the slice actually fits.
			while (cut > 1 && width(rest.slice(0, cut)) > w) cut--;
			out.push(rest.slice(0, cut).trimEnd());
			rest = rest.slice(cut);
		}
		out.push(rest);
	}
	return out;
}
