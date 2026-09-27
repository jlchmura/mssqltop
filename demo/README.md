# Demo environment

A disposable SQL Server 2022 Developer Edition in Docker, plus a load generator that makes it look like a busy production server. Use it to try mssqltop, develop against something realistic, or take screenshots.

## Quick start

You need Docker and the [ODBC Driver 18 for SQL Server](../README.md#installation).

```bash
npm run build        # once, so demo:top can run the CLI
npm run demo:up      # start SQL Server and seed the demo databases (~20s on first run)
npm run demo:load    # generate load; Ctrl-C to stop
npm run demo:top     # in another terminal: watch it with mssqltop
npm run demo:down    # stop the server (add -v to the compose command to delete its data)
```

The server listens on `localhost,14330`, bound to localhost only. `demo:top` connects as the `mssqltop` login, which has only `VIEW SERVER STATE`.

## What the load looks like

Each workload connects with its own login, application name and host name, so the process list reads like a real server:

| Workload   | Application     | Host(s)    | What it does                                                                                           |
| ---------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| storefront | Storefront Web  | WEB01–03   | 12 workers of short lookups and order inserts: Batch Requests/sec and most of Recent Expensive Queries |
| reports    | Reports Service | REPORTS01  | Parallel aggregations with large memory grants: the Tasks column and Active Expensive Queries          |
| inventory  | Inventory Sync  | ETL01      | Holds locks on a product category for a few seconds: blocking chains and a head blocker (`b` filter)   |
| etl        | Nightly ETL     | ETL01      | Copies orders into the Warehouse database and checkpoints: the Database I/O chart                      |
| adhoc      | Ad-hoc Query    | DEV-LAPTOP | A CPU-heavy parallel query every few seconds: the % Processor Time chart                               |

`node demo/load.mjs --storefront 24` doubles the storefront workers, and `--duration 300` stops after five minutes.

## Taking screenshots

- Give the load a minute to fill the charts and the Recent Expensive Queries window.
- Blocking comes and goes. Press `b` to show only blocked sessions and head blockers, `p` to pause on a good moment, and `Enter` on a row for its details and SQL text.
- `-i 1` refreshes every second for livelier charts: `npm run demo:top -- -i 1`.

## Details

- `compose.yaml` runs `mcr.microsoft.com/mssql/server:2022-latest` as `linux/amd64`. There's no ARM build, so on Apple Silicon Docker Desktop runs it under Rosetta, which is plenty fast for this.
- `entrypoint.sh` starts SQL Server and runs `seed.sql` once. The container reports healthy only after seeding completes, so `demo:up` returns when the data is ready.
- `seed.sql` creates `ShopDemo` (20k customers, 2k products, 300k orders, 900k order lines, plus stored procedures) and `Warehouse`, along with the `web_app`, `reporting`, `etl_service`, `analyst` and `mssqltop` logins.
- The SA and demo logins share the password `Demo!Passw0rd`. Set `MSSQLTOP_DEMO_PASSWORD` (it must not contain `'`) and `MSSQLTOP_DEMO_PORT` to change them. These are throwaway credentials; don't reuse this setup anywhere that matters.
