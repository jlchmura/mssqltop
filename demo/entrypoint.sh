#!/bin/bash
# Starts SQL Server, waits for it to accept connections, seeds the demo databases, then stays attached.
set -euo pipefail

SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -b)

/opt/mssql/bin/sqlservr &
server_pid=$!

echo "Waiting for SQL Server to start..."
# Logins work before databases finish recovery, so on a restart also wait for the demo databases to come online.
for _ in $(seq 1 120); do
	recovering=$("${SQLCMD[@]}" -h -1 -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE state_desc <> 'ONLINE'" 2>/dev/null || echo failed)
	if [[ "$recovering" =~ ^[[:space:]]*0[[:space:]]*$ ]]; then break; fi
	sleep 2
done

seeded=$("${SQLCMD[@]}" -h -1 -Q "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID('ShopDemo.dbo.SeedInfo') IS NULL THEN 'no' ELSE 'yes' END")
if [[ "$seeded" == *yes* ]]; then
	echo "Demo databases already seeded."
else
	echo "Seeding demo databases (the first start takes a minute or two)..."
	"${SQLCMD[@]}" -v DemoPassword="$MSSQL_SA_PASSWORD" -i /demo/seed.sql
	echo "Demo databases ready."
fi

wait "$server_pid"
