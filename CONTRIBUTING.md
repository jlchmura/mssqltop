# Contributing to mssqltop

Thanks for helping! This guide covers setup, how the code is organized, and the SQL Server quirks worth knowing before you change a query.

## Setup

You'll need Node.js 22+ and, to run the app against a real server, the [Microsoft ODBC Driver 18 for SQL Server](README.md#installation). The tests don't need a database or the ODBC driver.

```bash
npm install          # also builds dist/
npm test             # run the tests once
npm run test:watch   # re-run on change
npm run dev          # rebuild on change (tsc --watch)
node dist/cli.js -S your-server   # try it
```

Before opening a pull request, run everything CI runs:

```bash
npm run check        # typecheck + format check + tests
npm run format       # fix formatting
```

## Project layout

```
src/
  cli.tsx               Entry point: parse args, open connections, render the app
  args.ts               Command-line parsing (pure)
  db/
    connection-string.ts  ODBC connection-string building and escaping
    values.ts             Row normalization (BIGINT/BIT/text repair) and error messages
    db.ts                 Db: one serialized, self-healing ODBC connection
  sql/
    queries.ts          All T-SQL, modeled on SSMS Activity Monitor
  monitor/
    monitor.ts          Monitor: polling, scheduling, publishing state
    types.ts            Row and state types shared with the UI
    rows.ts             DMV row → typed row mappers, RateTracker
    series.ts           Overview counters → chart samples
    recent.ts           Plan-cache snapshots → Recent Expensive Queries rates
    group.ts            Fold parallel tasks into one row per session
  ui/
    App.tsx             Composition root: state, input and layout wiring
    view-state.ts       Focus, sorting, filters, overlays; handleKey reducer
    derive.ts           Filter + sort monitor data into table rows
    layout.ts           Split the terminal between charts and panels
    chrome.ts           Header, footer and panel titles
    overlays.ts         Help and detail views
    columns.ts          Column definitions for the three grids
    table-model.ts      Column layout, sorting, scrolling
    braille.ts          Braille area charts
    sql-highlight.ts    T-SQL highlighting for the detail view
    segments.ts         Styled text runs (Seg) and helpers
    format.ts           Text measurement and number formatting
    components/         Thin Ink components (Chart, Frame, Table, Detail, Line)
  test/                 Test helpers: fixtures and a fixed-size Ink renderer
```

## How it fits together

```
queries.ts ──► Db (odbc) ──► Monitor ──► MonitorState ──► App ──► pure view functions ──► Ink components
                               ▲                              │
                               └──── pause / refresh / … ◄────┘  (handleKey effects)
```

- **`Monitor`** owns two connections. The fast one runs the overview, processes and active-request queries every refresh. The slow one scans the plan cache for Recent Expensive Queries, so it never delays the charts. `Monitor` turns results into an immutable `MonitorState` that `App` reads through `useSyncExternalStore`.
- **Most logic lives in pure functions.** Delta math, grouping, key handling (`handleKey`), filtering/sorting (`deriveTables`), layout, titles, charts and highlighting are all plain functions. The React components just arrange their output. When adding behavior, prefer adding or extending a pure function and testing it directly.
- **Everything the UI draws is a `Seg[]` line** (styled text runs). Builders return `Seg[]` / `Seg[][]`, and `<Line>` renders them. Widths are measured with `displayWidth`, so wide CJK text lines up.

## SQL Server gotchas

These are enforced by tests in `src/sql/queries.test.ts`. Please keep them true:

1. **One statement per query.** The `odbc` package only returns the first result set.
2. **`(max)` columns go last in a SELECT list.** Otherwise the SQL Server ODBC driver fails with _Invalid Descriptor Index_. `statement_text` is always the final column.
3. **Tag every statement with `MARKER`** (`/*mssqltop*/`), so the tool's own queries are hidden from Recent Expensive Queries.
4. **Never block the workload.** Sessions run at `READ UNCOMMITTED` with `DEADLOCK_PRIORITY LOW` and a lock timeout (see `db.ts`). Avoid functions like `OBJECT_NAME()` that take locks regardless of isolation level.
5. **Mind version support.** Note which SQL Server version a DMV or column needs; the baseline is SQL Server 2012. Fall back gracefully when something is missing (see `fetchSessionDetail`).
6. **Validate anything interpolated into SQL.** `recentQueries` and `sessionDetail` check their inputs; follow that pattern.

Column names returned by the queries are a contract with the mappers in `src/monitor/rows.ts`.

## Common changes

- **Add a column:** add the SQL column in `queries.ts`, map it in `rows.ts`, add the field to `types.ts`, then add a `Column` in `columns.ts`. Give it a `priority` so narrow terminals drop it gracefully, and add a detail field in `overlays.ts` if it's worth showing there.
- **Add a key binding:** handle it in `handleKey` (`view-state.ts`), add it to `HELP` (`overlays.ts`) and, if space allows, `FOOTER_KEYS` (`chrome.ts`), and add a case to `view-state.test.ts`.
- **Add a chart or metric:** extend `OVERVIEW`, `Counters`/`sampleBetween` in `series.ts`, and the `Series` type, then render another `<Chart>` in `App.tsx`.

## Testing

- **Vitest**, with tests next to the code (`foo.ts` → `foo.test.ts`).
- **Monitor tests** use a fake `QueryRunner` (see `monitor.test.ts`), and `db.test.ts` mocks the `odbc` module.
- **UI tests** render into a fixed-size fake terminal with `renderInk` from `src/test/render.ts` and send keys with `press()`. Use the builders in `src/test/fixtures.ts` for rows and state.
- `npm run test:coverage` shows what's untested.

## Code style

- **Prettier** formats everything (`npm run format`). **TypeScript** runs in strict mode, with unused-code and unchecked-index checks.
- **There's no ESLint:** the project uses TypeScript 7, whose native compiler doesn't expose the API that `typescript-eslint` needs.
- Prefer small pure functions, descriptive names and a short comment explaining _why_ for anything non-obvious (SQL Server behavior especially).

## Pull requests

- Keep PRs focused, and describe what you changed and how you tested it. Include a screenshot for UI changes.
- If you tested against a real server, mention its SQL Server version and your OS.
- `npm run check` must pass.
