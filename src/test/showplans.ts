/** Hand-trimmed showplan XML documents for tests, in the shape SQL Server returns them. */

const NS = 'xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"';

/**
 * SELECT … FROM Orders WHERE CustomerID = @cid, as a live plan (per-thread runtime counters):
 * a Nested Loops over an Index Seek and a Key Lookup, with an implicit conversion warning on the
 * statement, a spill on the lookup, and a missing index suggestion.
 */
export const LOOKUP_PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML ${NS} Version="1.564" Build="16.0.1000.6">
<BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT o.OrderDate, o.Total FROM dbo.Orders o WHERE o.CustomerID = @cid AND o.Ref = @ref" StatementType="SELECT" StatementSubTreeCost="2" QueryHash="0x1234567890ABCDEF" CardinalityEstimationModelVersion="160">
<QueryPlan DegreeOfParallelism="4" CompileTime="12" MemoryGrant="1024">
	<MemoryGrantInfo SerialRequiredMemory="512" GrantedMemory="2048" MaxUsedMemory="1024"/>
	<MissingIndexes>
		<MissingIndexGroup Impact="87.4">
			<MissingIndex Database="[ShopDemo]" Schema="[dbo]" Table="[Orders]">
				<ColumnGroup Usage="EQUALITY"><Column Name="[CustomerID]" ColumnId="2"/></ColumnGroup>
				<ColumnGroup Usage="INEQUALITY"><Column Name="[OrderDate]" ColumnId="3"/></ColumnGroup>
				<ColumnGroup Usage="INCLUDE"><Column Name="[Total]" ColumnId="4"/></ColumnGroup>
			</MissingIndex>
		</MissingIndexGroup>
	</MissingIndexes>
	<Warnings>
		<PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(nvarchar(20),[ShopDemo].[dbo].[Orders].[Ref],0)=[@ref]"/>
		<PlanAffectingConvert ConvertIssue="Cardinality Estimate" Expression="CONVERT(varchar(19),[ShopDemo].[dbo].[Orders].[OrderDate] as [o].[OrderDate],120)"/>
		<PlanAffectingConvert ConvertIssue="Cardinality Estimate" Expression="CONVERT_IMPLICIT(int,[ShopDemo].[dbo].[Orders].[Code] as [o].[Code],0)"/>
	</Warnings>
	<RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="120" EstimatedTotalSubtreeCost="2" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row">
		<OutputList><ColumnReference Column="OrderDate"/></OutputList>
		<RunTimeInformation>
			<RunTimeCountersPerThread Thread="0" ActualRows="5000" ActualExecutions="1"/>
			<RunTimeCountersPerThread Thread="1" ActualRows="3431" ActualExecutions="1"/>
		</RunTimeInformation>
		<NestedLoops Optimized="0">
			<OuterReferences><ColumnReference Column="OrderID"/></OuterReferences>
			<RelOp NodeId="1" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="120" EstimatedTotalSubtreeCost="0.9" Parallel="0" EstimateRebinds="0" EstimateRewinds="0">
				<OutputList/>
				<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="8431" ActualExecutions="1"/></RunTimeInformation>
				<IndexScan Ordered="1" ScanDirection="FORWARD">
					<DefinedValues/>
					<Object Database="[ShopDemo]" Schema="[dbo]" Table="[Orders]" Index="[IX_Orders_Customer]" Alias="[o]" IndexKind="NonClustered"/>
					<SeekPredicates><SeekPredicateNew><SeekKeys>
						<Prefix ScanType="EQ">
							<RangeColumns><ColumnReference Database="[ShopDemo]" Schema="[dbo]" Table="[Orders]" Alias="[o]" Column="CustomerID"/></RangeColumns>
							<RangeExpressions><ScalarOperator ScalarString="[@cid]"><Identifier/></ScalarOperator></RangeExpressions>
						</Prefix>
						<StartRange ScanType="GE">
							<RangeColumns><ColumnReference Column="OrderDate"/></RangeColumns>
							<RangeExpressions><ScalarOperator ScalarString="[@from]"/></RangeExpressions>
						</StartRange>
					</SeekKeys></SeekPredicateNew></SeekPredicates>
				</IndexScan>
			</RelOp>
			<RelOp NodeId="2" PhysicalOp="Key Lookup" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="1" Parallel="0" EstimateRebinds="119" EstimateRewinds="0">
				<OutputList/>
				<Warnings>
					<SpillToTempDb SpillLevel="1" SpilledThreadCount="1"/>
					<PlanAffectingConvert ConvertIssue="Cardinality Estimate" Expression="CONVERT(varchar(19),[ShopDemo].[dbo].[Orders].[OrderDate] as [o].[OrderDate],120)"/>
					<PlanAffectingConvert ConvertIssue="Cardinality Estimate" Expression="CONVERT(char(1),[o].[Flag],0)"/>
				</Warnings>
				<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="8431" ActualExecutions="8431"/></RunTimeInformation>
				<IndexScan Lookup="1">
					<Object Database="[ShopDemo]" Schema="[dbo]" Table="[Orders]" Index="[PK_Orders]" Alias="[o]" TableReferenceId="-1" IndexKind="Clustered"/>
					<Predicate><ScalarOperator ScalarString="[ShopDemo].[dbo].[Orders].[Total] as [o].[Total]&gt;(1.0000000000000000e+002)"/></Predicate>
				</IndexScan>
			</RelOp>
		</NestedLoops>
	</RelOp>
</QueryPlan>
</StmtSimple>
</Statements></Batch></BatchSequence>
</ShowPlanXML>`;

/** A procedure-style batch: a SET with no plan, then an IF whose branch holds two statements. */
export const BATCH_PLAN = `<ShowPlanXML ${NS} Version="1.564">
<BatchSequence><Batch><Statements>
	<StmtSimple StatementText="SET @n = 1" StatementType="ASSIGN"/>
	<StmtCond StatementText="IF @n &gt; 0" StatementType="COND">
		<Condition><QueryPlan><RelOp NodeId="0" PhysicalOp="Constant Scan" LogicalOp="Constant Scan" EstimateRows="1" EstimatedTotalSubtreeCost="0.001"/></QueryPlan></Condition>
		<Then><Statements>
			<StmtSimple StatementText="SELECT * FROM dbo.A" StatementType="SELECT" StatementSubTreeCost="0.5" QueryHash="0xAAAAAAAAAAAAAAAA" StatementOptmEarlyAbortReason="TimeOut">
				<QueryPlan><RelOp NodeId="0" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="10" EstimatedTotalSubtreeCost="0.5"><TableScan><Object Table="[A]"/></TableScan></RelOp></QueryPlan>
			</StmtSimple>
			<StmtSimple StatementText="SELECT * FROM dbo.B" StatementType="SELECT" StatementSubTreeCost="0.25" QueryHash="0xBBBBBBBBBBBBBBBB">
				<QueryPlan><RelOp NodeId="0" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="4.5" EstimatedTotalSubtreeCost="0.25" EstimatedExecutionMode="Batch"><TableScan><Object Table="[B]"/></TableScan></RelOp></QueryPlan>
			</StmtSimple>
		</Statements></Then>
	</StmtCond>
</Statements></Batch></BatchSequence>
</ShowPlanXML>`;

/** An Adaptive Join: hash join inputs first and second, the alternative nested-loops seek third. */
export const ADAPTIVE_PLAN = `<ShowPlanXML ${NS}><BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT …" StatementType="SELECT" StatementSubTreeCost="10">
<QueryPlan>
	<RelOp NodeId="0" PhysicalOp="Adaptive Join" LogicalOp="Inner Join" EstimateRows="100" EstimatedTotalSubtreeCost="10">
		<AdaptiveJoin>
			<RelOp NodeId="1" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="100" EstimatedTotalSubtreeCost="4"><TableScan><Object Table="[A]"/></TableScan></RelOp>
			<RelOp NodeId="2" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="100" EstimatedTotalSubtreeCost="5"><TableScan><Object Table="[B]"/></TableScan></RelOp>
			<RelOp NodeId="3" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="50"><IndexScan><Object Table="[B]" Index="[IX_B]"/></IndexScan></RelOp>
		</AdaptiveJoin>
	</RelOp>
</QueryPlan>
</StmtSimple>
</Statements></Batch></BatchSequence></ShowPlanXML>`;
