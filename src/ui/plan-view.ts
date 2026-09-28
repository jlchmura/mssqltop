/**
 * Draws a parsed execution plan as an indented operator tree, EXPLAIN-style:
 *
 *    Cost  Est rows   Actual  Operator
 *      0%         1        1  SELECT
 *      3%       120    8,431  └─ Nested Loops (Inner Join)                70× estimate
 *     41%       120    8,431     ├─ Index Seek  Orders.IX_Orders_Customer
 *                                │    Seek: CustomerID = @cid
 */
import type {PlanNode, PlanStatement} from '../plan/showplan.js';
import type {PlanSource} from '../monitor/types.js';
import {fmtCompact, fmtInt, fmtKb, fit, oneLine, wrap} from './format.js';
import {truncateSegs, type Seg} from './segments.js';
import type {QueryOverlay} from './view-state.js';

const SOURCE_LABELS: Record<PlanSource, string> = {
	live: 'live · actual rows so far',
	estimated: 'estimated · from the plan cache',
};

const COST_W = 5;
const ROWS_W = 9;
/** Estimates this far off (either way) are flagged, once the row counts are big enough to matter. */
const MISESTIMATE_FACTOR = 10;
const MISESTIMATE_MIN_ROWS = 100;

export function renderPlan(statements: readonly PlanStatement[], source: PlanSource, width: number): Seg[][] {
	const heading = `── Plan (${SOURCE_LABELS[source]}) `;
	const out: Seg[][] = [
		[{text: heading + '─'.repeat(Math.max(0, width - heading.length)), color: 'green', bold: true}],
	];
	if (statements.length === 0) {
		out.push([{text: 'The plan has no statements.', color: 'gray'}]);
		return out;
	}
	statements.forEach((s, i) => {
		if (i > 0) out.push([]);
		out.push(...statementLines(s, statements.length > 1 ? `${i + 1}/${statements.length} ` : '', width));
	});
	return out.map(line => truncateSegs(line, width));
}

function statementLines(s: PlanStatement, ordinal: string, width: number): Seg[][] {
	const out: Seg[][] = [];
	const facts = [
		s.type,
		`cost ${fmtCost(s.cost)}`,
		s.dop != null && s.dop > 1 ? `DOP ${s.dop}` : '',
		s.memoryGrantKb
			? `grant ${fmtKb(s.memoryGrantKb)}${s.memoryUsedKb != null ? `, used ${fmtKb(s.memoryUsedKb)}` : ''}`
			: '',
		s.ceVersion ? `CE ${s.ceVersion}` : '',
		s.compileMs != null ? `compiled in ${s.compileMs} ms` : '',
	].filter(Boolean);
	out.push([
		{text: `Statement ${ordinal}`, bold: true},
		{text: facts.join(' · '), color: 'gray'},
	]);
	if (ordinal && s.text) out.push([{text: oneLine(s.text), color: 'gray'}]);
	for (const w of s.warnings)
		out.push([
			{text: '⚠ ', color: 'yellow'},
			{text: w, color: 'yellow'},
		]);
	if (s.explicitConverts.length) {
		const note = `ℹ CONVERT may affect cardinality estimates, which matters only if the result is used to filter or join: ${s.explicitConverts.join(', ')}`;
		out.push(...wrap(note, width).map((line): Seg[] => [{text: line, color: 'gray'}]));
	}
	for (const mi of s.missingIndexes)
		out.push([
			{text: '⚠ Missing index: ', color: 'yellow', bold: true},
			{text: mi, color: 'yellow'},
		]);
	if (!s.root) return out;

	const hasActual = anyActual(s.root);
	out.push(
		[],
		[
			{
				text:
					fit('Cost', COST_W, 'right') +
					fit('Est rows', ROWS_W + 1, 'right') +
					(hasActual ? fit('Actual', ROWS_W + 1, 'right') : ''),
				color: 'cyan',
				bold: true,
			},
			{text: '  Operator', color: 'cyan', bold: true},
		],
	);
	const numsW = COST_W + ROWS_W + 1 + (hasActual ? ROWS_W + 1 : 0) + 2;
	const total = s.cost || s.root.subtreeCost;
	const blank = ' '.repeat(numsW);
	const visit = (node: PlanNode, lead: string, connector: string, childLead: string, note = '') => {
		out.push([
			...numberSegs(node, total, hasActual),
			{text: '  '},
			{text: lead + connector, color: 'gray'},
			...operatorSegs(node),
			...(note ? [{text: `  ${note}`, color: 'gray'}] : []),
		]);
		const detailLead = childLead + (node.children.length ? '│  ' : '   ');
		const detail = (label: string, text: string, color = 'gray') =>
			out.push([
				{text: blank},
				{text: detailLead, color: 'gray'},
				{text: label, color: 'gray', bold: true},
				{text, color},
			]);
		if (node.seek) detail('Seek: ', node.seek);
		if (node.predicate) detail('Predicate: ', node.predicate);
		for (const w of node.warnings) detail('⚠ ', w, 'yellow');
		node.children.forEach((c, i) => {
			const last = i === node.children.length - 1;
			const note = c.alternative && !node.alternative ? '(alternative: used when few rows arrive)' : '';
			visit(c, childLead, last ? '└─ ' : '├─ ', childLead + (last ? '   ' : '│  '), note);
		});
	};
	visit(s.root, '', '', '');
	return out;
}

function numberSegs(node: PlanNode, total: number, hasActual: boolean): Seg[] {
	const pct = total > 0 && !node.alternative ? (node.selfCost / total) * 100 : 0;
	const segs: Seg[] = [
		{
			text: fit(node.alternative ? '' : `${Math.round(pct)}%`, COST_W, 'right'),
			color: pct >= 50 ? 'red' : pct >= 20 ? 'yellow' : undefined,
			bold: pct >= 20,
		},
		{text: fit(fmtRows(node.estRows), ROWS_W + 1, 'right')},
	];
	if (hasActual) {
		const off = misestimate(node);
		segs.push({
			text: fit(node.actualRows == null ? '' : fmtRows(node.actualRows), ROWS_W + 1, 'right'),
			color: off ? 'yellow' : undefined,
			bold: Boolean(off),
		});
	}
	return segs;
}

function operatorSegs(node: PlanNode): Seg[] {
	const name =
		node.logicalOp && node.logicalOp !== node.physicalOp ? `${node.physicalOp} (${node.logicalOp})` : node.physicalOp;
	const segs: Seg[] = [{text: name, color: 'cyan'}];
	if (node.batchMode) segs.push({text: ' [batch]', color: 'gray'});
	if (node.object) segs.push({text: `  ${node.object}`});
	if (node.warnings.length) segs.push({text: ' ⚠', color: 'yellow', bold: true});
	const off = misestimate(node);
	if (off) segs.push({text: `  ${off}`, color: 'yellow'});
	return segs;
}

/** "70× estimate" or "1/70 estimate" when actual rows are far from the estimate; '' otherwise. */
export function misestimate(node: PlanNode): string {
	if (node.actualRows == null) return '';
	const actual = node.actualRows;
	const est = Math.max(node.estRows, 1);
	if (Math.max(actual, est) < MISESTIMATE_MIN_ROWS) return '';
	const ratio = actual / est;
	if (ratio >= MISESTIMATE_FACTOR) return `${fmtCompact(Math.round(ratio))}× estimate`;
	if (ratio > 0 && ratio <= 1 / MISESTIMATE_FACTOR) return `1/${fmtCompact(Math.round(1 / ratio))} estimate`;
	return '';
}

const anyActual = (n: PlanNode): boolean => n.actualRows != null || n.children.some(anyActual);

/** 4.5, 8,431, 994,120, 27.5M: exact until the column would overflow. */
function fmtRows(v: number): string {
	if (v < 10 && !Number.isInteger(v)) return v.toFixed(1);
	return v < 1e6 ? fmtInt(v) : fmtCompact(v);
}

const fmtCost = (v: number) => (v >= 100 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toPrecision(2));

/** `mssqltop-session55-20260928-143015.sqlplan`: SSMS, Azure Data Studio and Plan Explorer open these. */
export function planFileName(o: QueryOverlay, now: Date): string {
	const who =
		o.kind === 'active' ? `session${o.row.sessionId}` : /^0x[0-9A-F]{16}$/i.test(o.row.key) ? o.row.key : 'query';
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `mssqltop-${who}-${date}-${time}.sqlplan`;
}
