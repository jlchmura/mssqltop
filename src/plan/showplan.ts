/**
 * Turns showplan XML (from sys.dm_exec_text_query_plan or sys.dm_exec_query_statistics_xml) into
 * a statement list with an operator tree per statement, keeping the parts worth showing in a
 * terminal: costs, row estimates and actuals, the object each operator touches, its predicates,
 * and the warnings SSMS flags with a yellow triangle.
 */
import {child, descendants, parseXml, type XmlElement} from './xml.js';

export interface PlanNode {
	nodeId: number;
	physicalOp: string;
	logicalOp: string;
	/** Estimated rows across all executions (SSMS's "Estimated Number of Rows for All Executions"). */
	estRows: number;
	estExecutions: number;
	subtreeCost: number;
	/** This operator's own cost: its subtree cost less its children's. */
	selfCost: number;
	parallel: boolean;
	batchMode: boolean;
	/**
	 * Part of an Adaptive Join's alternative inner input (the seek it switches to when few rows arrive).
	 * Its costs aren't part of the statement's, so no share of the total applies.
	 */
	alternative: boolean;
	/** Table/index the operator reads or writes, e.g. `Orders.IX_Orders_Customer`. */
	object: string;
	seek: string;
	predicate: string;
	warnings: string[];
	/** Summed across threads; null unless the plan carries runtime statistics. */
	actualRows: number | null;
	actualExecutions: number | null;
	children: PlanNode[];
}

export interface PlanStatement {
	text: string;
	type: string;
	queryHash: string;
	cost: number;
	dop: number | null;
	memoryGrantKb: number | null;
	memoryUsedKb: number | null;
	ceVersion: string;
	compileMs: number | null;
	warnings: string[];
	/**
	 * Explicit CONVERTs SQL Server flags as possibly affecting cardinality estimates. It flags every one,
	 * including those that only format output, so these are shown as a note rather than a warning.
	 */
	explicitConverts: string[];
	missingIndexes: string[];
	/** Null for statements without an operator tree (e.g. SET or DECLARE). */
	root: PlanNode | null;
}

/** Elements of a RelOp that describe it rather than being its operator-specific element. */
const RELOP_META = new Set([
	'OutputList',
	'Warnings',
	'MemoryFractions',
	'RunTimeInformation',
	'RunTimePartitionSummary',
	'InternalInfo',
	'IndexedViewInfo',
]);
const RELOP = new Set(['RelOp']);

export function parseShowplan(xml: string): PlanStatement[] {
	const statements: PlanStatement[] = [];
	// Statements can nest (IF/WHILE bodies, cursors), so collect every QueryPlan with the closest
	// statement element above it.
	const visit = (el: XmlElement, stmt: XmlElement | null) => {
		const here = 'StatementText' in el.attrs || 'StatementType' in el.attrs ? el : stmt;
		for (const c of el.children) {
			if (c.name === 'QueryPlan') statements.push(statement(here, c));
			else if (c.name !== 'RelOp') visit(c, here);
		}
	};
	visit(parseXml(xml), null);
	return statements;
}

function statement(stmt: XmlElement | null, plan: XmlElement): PlanStatement {
	const a = stmt?.attrs ?? {};
	const grant = child(plan, 'MemoryGrantInfo')?.attrs;
	const rootEl = child(plan, 'RelOp');
	const explicitConverts: string[] = [];
	const root = rootEl ? relOp(rootEl, explicitConverts) : null;
	const warnings = warningsOf(child(plan, 'Warnings'), explicitConverts);
	if (a.StatementOptmEarlyAbortReason === 'TimeOut')
		warnings.push('The optimizer timed out; the plan may not be a good one');
	else if (a.StatementOptmEarlyAbortReason === 'MemoryLimitExceeded')
		warnings.push('The optimizer ran out of memory; the plan may not be a good one');
	return {
		text: a.StatementText ?? '',
		type: a.StatementType ?? '',
		queryHash: a.QueryHash ?? '',
		cost: numAttr(a.StatementSubTreeCost) ?? root?.subtreeCost ?? 0,
		dop: numAttr(plan.attrs.DegreeOfParallelism) ?? null,
		memoryGrantKb: numAttr(grant?.GrantedMemory) ?? null,
		memoryUsedKb: numAttr(grant?.MaxUsedMemory) ?? null,
		ceVersion: a.CardinalityEstimationModelVersion ?? '',
		compileMs: numAttr(plan.attrs.CompileTime) ?? null,
		warnings,
		explicitConverts: [...new Set(explicitConverts)],
		missingIndexes: descendants(plan, 'MissingIndexGroup', RELOP).flatMap(missingIndexes),
		root,
	};
}

function relOp(el: XmlElement, explicitConverts: string[]): PlanNode {
	const a = el.attrs;
	const op = el.children.find(c => !RELOP_META.has(c.name));
	const children = op ? descendants(op, 'RelOp', RELOP).map(c => relOp(c, explicitConverts)) : [];
	// An Adaptive Join's third input is the alternative to its second; only one of them runs.
	if (a.PhysicalOp === 'Adaptive Join' && children.length === 3) markAlternative(children[2]!);
	const costed = children.filter(c => !c.alternative);
	const subtreeCost = numAttr(a.EstimatedTotalSubtreeCost) ?? 0;
	const estExecutions = 1 + (numAttr(a.EstimateRebinds) ?? 0) + (numAttr(a.EstimateRewinds) ?? 0);
	const counters = child(el, 'RunTimeInformation')?.children.filter(c => c.name === 'RunTimeCountersPerThread') ?? [];
	const sum = (attr: string) => counters.reduce((n, c) => n + (numAttr(c.attrs[attr]) ?? 0), 0);
	return {
		nodeId: numAttr(a.NodeId) ?? 0,
		physicalOp: a.PhysicalOp ?? '',
		logicalOp: a.LogicalOp ?? '',
		estRows: (numAttr(a.EstimateRows) ?? 0) * estExecutions,
		estExecutions,
		subtreeCost,
		selfCost: Math.max(0, subtreeCost - costed.reduce((n, c) => n + c.subtreeCost, 0)),
		parallel: a.Parallel === '1' || a.Parallel === 'true',
		batchMode: (a.ActualExecutionMode ?? a.EstimatedExecutionMode) === 'Batch',
		alternative: false,
		object: op ? objectName(op) : '',
		seek: op ? seekPredicate(op) : '',
		predicate: op ? residualPredicate(op) : '',
		warnings: warningsOf(child(el, 'Warnings'), explicitConverts),
		actualRows: counters.length ? sum('ActualRows') : null,
		actualExecutions: counters.length ? sum('ActualExecutions') : null,
		children,
	};
}

function markAlternative(node: PlanNode): void {
	node.alternative = true;
	node.children.forEach(markAlternative);
}

const unbracket = (s: string | undefined) => (s ?? '').replace(/^\[|\]$/g, '').replace(/\]\.\[/g, '.');

function objectName(op: XmlElement): string {
	const obj = child(op, 'Object') ?? descendants(op, 'Object', RELOP)[0];
	if (!obj) return '';
	const table = unbracket(obj.attrs.Table);
	const index = unbracket(obj.attrs.Index);
	return [table, index].filter(Boolean).join('.');
}

const SCAN_TYPES: Record<string, string> = {EQ: '=', GT: '>', GE: '>=', LT: '<', LE: '<=', IS: 'IS', ISNOT: 'IS NOT'};

/** `CustomerID = @cid AND OrderDate >= @from`, built from the seek keys' columns and range expressions. */
function seekPredicate(op: XmlElement): string {
	const seeks = child(op, 'SeekPredicates');
	if (!seeks) return '';
	const terms: string[] = [];
	for (const range of [
		...descendants(seeks, 'Prefix'),
		...descendants(seeks, 'StartRange'),
		...descendants(seeks, 'EndRange'),
	]) {
		const cols = descendants(child(range, 'RangeColumns') ?? range, 'ColumnReference').map(c => c.attrs.Column ?? '');
		const exprs = (child(range, 'RangeExpressions')?.children ?? []).map(s => tidyScalar(s.attrs.ScalarString ?? '?'));
		const opText = SCAN_TYPES[range.attrs.ScanType ?? ''] ?? range.attrs.ScanType ?? '=';
		cols.forEach((col, i) => terms.push(`${col} ${opText} ${exprs[i] ?? '?'}`));
	}
	return terms.join(' AND ');
}

/** The filter an operator applies to each row: Predicate, or a join's residual. */
function residualPredicate(op: XmlElement): string {
	for (const name of ['Predicate', 'ProbeResidual', 'Residual']) {
		const scalar = child(op, name)?.children.find(c => c.name === 'ScalarOperator');
		if (scalar?.attrs.ScalarString) return tidyScalar(scalar.attrs.ScalarString);
	}
	return '';
}

/** Warning messages; explicit CONVERTs flagged only for cardinality estimates go to `explicitConverts`. */
function warningsOf(el: XmlElement | undefined, explicitConverts: string[]): string[] {
	if (!el) return [];
	const out: string[] = [];
	if (el.attrs.NoJoinPredicate === 'true' || el.attrs.NoJoinPredicate === '1') out.push('No join predicate');
	if (el.attrs.UnmatchedIndexes === 'true' || el.attrs.UnmatchedIndexes === '1')
		out.push('A filtered index could not be used');
	for (const w of el.children) {
		const a = w.attrs;
		switch (w.name) {
			case 'PlanAffectingConvert': {
				const expression = tidyScalar(a.Expression ?? '');
				const implicit = /^CONVERT_IMPLICIT\b/i.test(expression);
				if (a.ConvertIssue === 'Cardinality Estimate' && !implicit) explicitConverts.push(expression);
				else
					out.push(
						`${implicit ? 'Implicit conversion' : 'Type conversion'} may affect ${(a.ConvertIssue ?? 'the plan').toLowerCase()}: ${expression}`,
					);
				break;
			}
			case 'SpillToTempDb':
				out.push(`Spilled to tempdb${a.SpillLevel ? ` (level ${a.SpillLevel})` : ''}`);
				break;
			case 'SortSpillDetails':
			case 'HashSpillDetails':
			case 'ExchangeSpillDetails':
				out.push(`Spilled to tempdb${a.WritesToTempDb ? `: ${a.WritesToTempDb} pages written` : ''}`);
				break;
			case 'ColumnsWithNoStatistics':
				out.push(
					`No statistics on ${descendants(w, 'ColumnReference')
						.map(c => c.attrs.Column)
						.join(', ')}`,
				);
				break;
			case 'MemoryGrantWarning':
				out.push(
					`Memory grant: ${a.GrantWarningKind ?? 'warning'} (granted ${a.GrantedMemory ?? '?'} KB, used ${a.MaxUsedMemory ?? '?'} KB)`,
				);
				break;
			case 'WaitForMemoryGrant':
				out.push(`Waited ${a.WaitTime ?? '?'} ms for a memory grant`);
				break;
			case 'Wait':
				break; // wait statistics, not a problem with the plan
			default:
				out.push(humanize(w.name));
		}
	}
	return out;
}

/** `[ShopDemo].[dbo].[Orders] (CustomerID) INCLUDE (OrderDate) · impact 87%`. */
function missingIndexes(group: XmlElement): string[] {
	const impact = numAttr(group.attrs.Impact);
	return group.children
		.filter(c => c.name === 'MissingIndex')
		.map(mi => {
			const cols = (usage: string) =>
				mi.children
					.filter(g => g.name === 'ColumnGroup' && g.attrs.Usage === usage)
					.flatMap(g => g.children.map(c => unbracket(c.attrs.Name)));
			const keys = [...cols('EQUALITY'), ...cols('INEQUALITY')];
			const include = cols('INCLUDE');
			const table = [mi.attrs.Database, mi.attrs.Schema, mi.attrs.Table].map(unbracket).join('.');
			return (
				`${table} (${keys.join(', ')})` +
				(include.length ? ` INCLUDE (${include.join(', ')})` : '') +
				(impact == null ? '' : ` · impact ${Math.round(impact)}%`)
			);
		});
}

const PART = String.raw`\[((?:[^\]]|\]\])+)\]`;
const QUALIFIED_ALIASED = new RegExp(String.raw`(?:${PART}\.){2,3}${PART} as ${PART}\.${PART}`, 'g');
const QUALIFIED = new RegExp(String.raw`(?:${PART}\.)*${PART}\.${PART}`, 'g');
const FLOAT_CONST = /\(([-+]?\d\.\d+e[-+]\d+)\)/g;

/**
 * Shortens showplan's fully qualified column references the way SSMS tooltips read:
 * `[Db].[dbo].[Orders].[Total] as [o].[Total]` → `o.Total`, `[Db].[dbo].[Orders].[Total]` → `Orders.Total`,
 * `[Expr1002]` → `Expr1002`, and `(1.0000000000000000e+002)` → `(100)`.
 */
export function tidyScalar(s: string): string {
	return s
		.replace(QUALIFIED_ALIASED, (...m: string[]) => `${m[m.length - 4]}.${m[m.length - 3]}`.replace(/\]\]/g, ']'))
		.replace(QUALIFIED, whole => {
			const parts = [...whole.matchAll(new RegExp(PART, 'g'))].map(p => p[1]!.replace(/\]\]/g, ']'));
			return parts.slice(-2).join('.');
		})
		.replace(/\[([@#]?\w+)\]/g, '$1')
		.replace(FLOAT_CONST, (_, f: string) => `(${Number(f)})`);
}

const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

function numAttr(v: string | undefined): number | undefined {
	if (v == null || v === '') return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/** The statements of a (possibly multi-statement) plan that belong to a query hash, or all of them. */
export function statementsFor(statements: readonly PlanStatement[], queryHash: string | undefined): PlanStatement[] {
	const withTree = statements.filter(s => s.root);
	const matching = queryHash ? withTree.filter(s => s.queryHash.toLowerCase() === queryHash.toLowerCase()) : [];
	return matching.length ? matching : withTree.length ? withTree : [...statements];
}
