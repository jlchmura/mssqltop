import {describe, expect, it} from 'vitest';
import {parseShowplan, type PlanNode} from '../plan/showplan.js';
import {activeRow, recentRow} from '../test/fixtures.js';
import {ADAPTIVE_PLAN, BATCH_PLAN, LOOKUP_PLAN} from '../test/showplans.js';
import {misestimate, planFileName, renderPlan} from './plan-view.js';
import {segWidth, type Seg} from './segments.js';

const text = (lines: Seg[][]) =>
	lines.map(l =>
		l
			.map(s => s.text)
			.join('')
			.trimEnd(),
	);

describe('renderPlan', () => {
	it('draws a live plan as a tree with costs, estimates and actuals', () => {
		const lines = text(renderPlan(parseShowplan(LOOKUP_PLAN), 'live', 110));
		expect(lines[0]).toMatch(/^── Plan \(live · actual rows so far\) ─+$/);
		expect(lines[0]).toHaveLength(110);
		expect(lines[1]).toBe(
			'Statement SELECT · cost 2.0 · DOP 4 · grant 2.0 MB, used 1.0 MB · CE 160 · compiled in 12 ms',
		);
		expect(lines).toContain(
			'⚠ Implicit conversion may affect seek plan: CONVERT_IMPLICIT(nvarchar(20),Orders.Ref,0)=@ref',
		);
		expect(lines).toContain(
			'ℹ CONVERT may affect cardinality estimates, which matters only if the result is used to filter or join:',
		);
		expect(lines).toContain('CONVERT(varchar(19),o.OrderDate,120), CONVERT(char(1),o.Flag,0)');
		expect(lines).toContain(
			'⚠ Missing index: ShopDemo.dbo.Orders (CustomerID, OrderDate) INCLUDE (Total) · impact 87%',
		);
		const tree = lines.slice(lines.indexOf(' Cost  Est rows    Actual  Operator'));
		expect(tree).toEqual([
			' Cost  Est rows    Actual  Operator',
			'   5%       120     8,431  Nested Loops (Inner Join)  70× estimate',
			'  45%       120     8,431  ├─ Index Seek  Orders.IX_Orders_Customer  70× estimate',
			'                           │     Seek: CustomerID = @cid AND OrderDate >= @from',
			'  50%       120     8,431  └─ Key Lookup (Clustered Index Seek)  Orders.PK_Orders ⚠  70× estimate',
			'                                 Predicate: o.Total>(100)',
			'                                 ⚠ Spilled to tempdb (level 1)',
		]);
	});

	it('colors costly operators and misestimated rows', () => {
		const lines = renderPlan(parseShowplan(LOOKUP_PLAN), 'live', 110);
		const row = lines.find(l => l.some(s => s.text.includes('Key Lookup')))!;
		expect(row[0]).toMatchObject({text: '  50%', color: 'red', bold: true});
		expect(row[2]).toMatchObject({color: 'yellow', bold: true});
		const seekRow = lines.find(l => l.some(s => s.text.includes('Index Seek')))!;
		expect(seekRow[0]).toMatchObject({color: 'yellow'});
	});

	it('leaves out the Actual column for estimated plans and numbers multiple statements', () => {
		const lines = text(renderPlan(parseShowplan(BATCH_PLAN).slice(1), 'estimated', 80));
		expect(lines[0]).toContain('estimated · from the plan cache');
		expect(lines).toContain(' Cost  Est rows  Operator');
		expect(lines).toContain('Statement 1/2 SELECT · cost 0.50');
		expect(lines).toContain('SELECT * FROM dbo.B');
		expect(lines).toContain(' 100%       4.5  Table Scan [batch]  B');
	});

	it('shows an Adaptive Join’s alternative input without a share of the cost', () => {
		expect(text(renderPlan(parseShowplan(ADAPTIVE_PLAN), 'estimated', 100)).slice(-4)).toEqual([
			'  10%       100  Adaptive Join (Inner Join)',
			'  40%       100  ├─ Table Scan  A',
			'  50%       100  ├─ Table Scan  B',
			'              1  └─ Index Seek  B.IX_B  (alternative: used when few rows arrive)',
		]);
	});

	it('fits every line to the width', () => {
		for (const line of renderPlan(parseShowplan(LOOKUP_PLAN), 'live', 40))
			expect(segWidth(line)).toBeLessThanOrEqual(40);
	});

	it('says so when there are no statements', () => {
		expect(text(renderPlan([], 'estimated', 40))).toContain('The plan has no statements.');
	});
});

describe('misestimate', () => {
	const node = (estRows: number, actualRows: number | null) => ({estRows, actualRows}) as PlanNode;

	it('flags estimates ten times too low or too high once rows matter', () => {
		expect(misestimate(node(100, 8431))).toBe('84× estimate');
		expect(misestimate(node(50_000, 10))).toBe('1/5000 estimate');
		expect(misestimate(node(0, 250))).toBe('250× estimate');
	});

	it('ignores small counts, close estimates and missing actuals', () => {
		expect(misestimate(node(1, 50))).toBe('');
		expect(misestimate(node(100, 500))).toBe('');
		expect(misestimate(node(100, null))).toBe('');
		expect(misestimate(node(1000, 0))).toBe('');
	});
});

describe('planFileName', () => {
	const now = new Date(2026, 8, 28, 14, 5, 9);

	it('names the file after the session or query hash and the time', () => {
		expect(planFileName({kind: 'active', row: activeRow({sessionId: 55})}, now)).toBe(
			'mssqltop-session55-20260928-140509.sqlplan',
		);
		expect(planFileName({kind: 'recent', row: recentRow({key: '0x1234567890ABCDEF'})}, now)).toBe(
			'mssqltop-0x1234567890ABCDEF-20260928-140509.sqlplan',
		);
		expect(planFileName({kind: 'recent', row: recentRow({key: '0x0200ab:12'})}, now)).toBe(
			'mssqltop-query-20260928-140509.sqlplan',
		);
	});
});
