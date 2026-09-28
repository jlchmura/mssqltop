import {describe, expect, it} from 'vitest';
import {ADAPTIVE_PLAN, BATCH_PLAN, LOOKUP_PLAN} from '../test/showplans.js';
import {parseShowplan, statementsFor, tidyScalar} from './showplan.js';

describe('parseShowplan', () => {
	const [stmt] = parseShowplan(LOOKUP_PLAN);
	const root = stmt!.root!;
	const [seek, lookup] = root.children;

	it('reads the statement header', () => {
		expect(stmt).toMatchObject({
			type: 'SELECT',
			queryHash: '0x1234567890ABCDEF',
			cost: 2,
			dop: 4,
			memoryGrantKb: 2048,
			memoryUsedKb: 1024,
			ceVersion: '160',
			compileMs: 12,
		});
		expect(stmt!.text).toContain('WHERE o.CustomerID = @cid');
	});

	it('builds the operator tree from RelOps nested inside operator elements', () => {
		expect(root.physicalOp).toBe('Nested Loops');
		expect(root.logicalOp).toBe('Inner Join');
		expect(root.children.map(c => c.physicalOp)).toEqual(['Index Seek', 'Key Lookup']);
	});

	it('works out each operator’s own cost from subtree costs', () => {
		expect(root.selfCost).toBeCloseTo(0.1);
		expect(seek!.selfCost).toBeCloseTo(0.9);
		expect(lookup!.selfCost).toBeCloseTo(1);
	});

	it('scales estimated rows by estimated executions', () => {
		expect(lookup!.estExecutions).toBe(120);
		expect(lookup!.estRows).toBe(120);
	});

	it('sums runtime counters across threads', () => {
		expect(root.actualRows).toBe(8431);
		expect(root.actualExecutions).toBe(2);
		expect(lookup!.actualExecutions).toBe(8431);
	});

	it('names the object and readable seek and residual predicates', () => {
		expect(seek!.object).toBe('Orders.IX_Orders_Customer');
		expect(seek!.seek).toBe('CustomerID = @cid AND OrderDate >= @from');
		expect(lookup!.object).toBe('Orders.PK_Orders');
		expect(lookup!.predicate).toBe('o.Total>(100)');
	});

	it('collects statement and operator warnings and missing indexes', () => {
		expect(stmt!.warnings).toEqual([
			'Implicit conversion may affect seek plan: CONVERT_IMPLICIT(nvarchar(20),Orders.Ref,0)=@ref',
			'Implicit conversion may affect cardinality estimate: CONVERT_IMPLICIT(int,o.Code,0)',
		]);
		expect(lookup!.warnings).toEqual(['Spilled to tempdb (level 1)']);
		expect(stmt!.missingIndexes).toEqual(['ShopDemo.dbo.Orders (CustomerID, OrderDate) INCLUDE (Total) · impact 87%']);
	});

	it('sets explicit CONVERTs flagged for cardinality estimates apart, once each', () => {
		expect(stmt!.explicitConverts).toEqual(['CONVERT(varchar(19),o.OrderDate,120)', 'CONVERT(char(1),o.Flag,0)']);
		const explicitSeek = parseShowplan(
			'<ShowPlanXML><QueryPlan><Warnings><PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT(int,[x])"/></Warnings></QueryPlan></ShowPlanXML>',
		)[0]!;
		expect(explicitSeek.warnings).toEqual(['Type conversion may affect seek plan: CONVERT(int,x)']);
		expect(explicitSeek.explicitConverts).toEqual([]);
	});

	it('leaves an Adaptive Join’s alternative input out of its cost', () => {
		const join = parseShowplan(ADAPTIVE_PLAN)[0]!.root!;
		expect(join.selfCost).toBeCloseTo(1);
		expect(join.children.map(c => c.alternative)).toEqual([false, false, true]);
	});

	it('finds statements nested in control flow, including their conditions', () => {
		const statements = parseShowplan(BATCH_PLAN);
		expect(statements.map(s => s.text)).toEqual(['IF @n > 0', 'SELECT * FROM dbo.A', 'SELECT * FROM dbo.B']);
		expect(statements[1]!.warnings).toEqual(['The optimizer timed out; the plan may not be a good one']);
		expect(statements[2]!.root).toMatchObject({object: 'B', batchMode: true, actualRows: null});
	});

	it('reads operator warnings of every kind', () => {
		const warn = (inner: string, attrs = '') =>
			parseShowplan(
				`<ShowPlanXML><StmtSimple StatementText="x"><QueryPlan><RelOp PhysicalOp="Sort"><Warnings ${attrs}>${inner}</Warnings><Sort/></RelOp></QueryPlan></StmtSimple></ShowPlanXML>`,
			)[0]!.root!.warnings;
		expect(warn('', 'NoJoinPredicate="true" UnmatchedIndexes="1"')).toEqual([
			'No join predicate',
			'A filtered index could not be used',
		]);
		expect(warn('<SortSpillDetails WritesToTempDb="42"/>')).toEqual(['Spilled to tempdb: 42 pages written']);
		expect(
			warn(
				'<ColumnsWithNoStatistics><ColumnReference Column="a"/><ColumnReference Column="b"/></ColumnsWithNoStatistics>',
			),
		).toEqual(['No statistics on a, b']);
		expect(
			warn('<MemoryGrantWarning GrantWarningKind="Excessive Grant" GrantedMemory="100" MaxUsedMemory="1"/>'),
		).toEqual(['Memory grant: Excessive Grant (granted 100 KB, used 1 KB)']);
		expect(warn('<WaitForMemoryGrant WaitTime="250"/><Wait WaitType="X"/>')).toEqual([
			'Waited 250 ms for a memory grant',
		]);
		expect(warn('<FullUpdateForOnlineIndexBuild/>')).toEqual(['Full Update For Online Index Build']);
	});

	it('handles statements with nothing to show', () => {
		expect(parseShowplan('<ShowPlanXML><StmtSimple StatementText="SET x"/></ShowPlanXML>')).toEqual([]);
		const [bare] = parseShowplan('<ShowPlanXML><QueryPlan/></ShowPlanXML>');
		expect(bare).toMatchObject({text: '', cost: 0, dop: null, root: null});
	});
});

describe('statementsFor', () => {
	const statements = parseShowplan(BATCH_PLAN);

	it('picks the statements matching the query hash', () => {
		expect(statementsFor(statements, '0xbbbbbbbbbbbbbbbb').map(s => s.text)).toEqual(['SELECT * FROM dbo.B']);
	});

	it('falls back to every statement with an operator tree', () => {
		expect(statementsFor(statements, '0x0000000000000000')).toHaveLength(3);
		expect(statementsFor(statements, undefined)).toHaveLength(3);
		const noTrees = parseShowplan('<ShowPlanXML><QueryPlan/></ShowPlanXML>');
		expect(statementsFor(noTrees, undefined)).toHaveLength(1);
	});
});

describe('tidyScalar', () => {
	it.each([
		['[Db].[dbo].[Orders].[Total] as [o].[Total]', 'o.Total'],
		['[Db].[dbo].[Orders].[Total]', 'Orders.Total'],
		['[Expr1002] IS NULL', 'Expr1002 IS NULL'],
		['[@cid]', '@cid'],
		['[x]>(1.5000000000000000e+001)', 'x>(15)'],
		["PROBE([Bitmap1],[Db].[dbo].[T].[c],N'[IN ROW]')", "PROBE(Bitmap1,T.c,N'[IN ROW]')"],
		['[Db].[dbo].[Odd]]Name].[c]', 'Odd]Name.c'],
	])('%s → %s', (input, expected) => {
		expect(tidyScalar(input)).toBe(expected);
	});
});
