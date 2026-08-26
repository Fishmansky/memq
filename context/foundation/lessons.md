# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Run independent Supabase queries concurrently with Promise.all

**Context:** src/pages/sets/[id]/[algoId].astro — server-rendered Astro pages with multiple independent data fetches

**Problem:** When two Supabase queries don't depend on each other's results, awaiting them sequentially adds a full round-trip of unnecessary latency to every page load.

**Rule:** When a page needs data from two independent queries, use Promise.all([query1, query2]) instead of sequential awaits.

**Applies to:** All Astro server pages that fetch from multiple Supabase tables where query 2 doesn't depend on query 1's result.

## An RLS break-check must relax every policy the query touches

**Context:** src/test/integration/listIsolation.int.test.ts — Phase 5 deliberate-break check of `alg_select` / `al_select` on `algorithms` / `algorithm_lists`

**Problem:** A PostgREST query with an embedded join (`select("…, algorithm_lists!inner(name, is_system)")`) is filtered by the *parent* table's policy as well as the child's. Relaxing only `alg_select` to `USING (true)` left the FR-015 scope test green — B's list was still invisible via `al_select`, so the row dropped out of the inner join anyway. The plan had predicted a red test and would have been "confirmed" by the wrong evidence: a test that passes for a reason unrelated to the policy it claims to pin.

**Rule:** Before claiming a test pins policy X, list every table the query touches (embedded joins included) and relax each policy in turn. A test whose query joins a second table proves the conjunction of both policies, not X alone. To pin one policy in isolation, the test needs a join-free query against that table.

**Applies to:** Every RLS deliberate-break check, and any integration test asserting that one specific policy carries a risk. Mirror the app query under test — but do not inherit its joins into the claim about what the test proves.

## Order by an embedded table with `order("table(column)")`, not `referencedTable`

**Context:** src/lib/lists/addAlgorithm.ts:110-121 — duplicate lookup ordering pre-built lists ahead of user lists

**Problem:** `.order("is_system", { referencedTable: "algorithm_lists" })` is a **silent no-op**: PostgREST returns 200 with rows in unspecified order rather than erroring, so a wrong duplicate-match winner looks like a data problem, not a query bug.

**Rule:** To order by a column on an embedded table, put it in the column string — `.order("algorithm_lists(is_system)", { ascending: false })`. Verify the emitted query string (`order=algorithm_lists(is_system).desc`), never just the HTTP status.

**Applies to:** Any Supabase/PostgREST query ordering by a column from an embedded (`!inner` or nested) relation.

## Treat generated Supabase columns as optional-in-Insert and nullable-in-Row

**Context:** src/db/database.types.ts:82,92 — `moves_normalized`, a Postgres generated column on `algorithms`

**Problem:** The Supabase CLI types a generated column as `moves_normalized?: string | null` in `Insert` and `string | null` in `Row`. The `Insert` optionality is a trap in the opposite direction from usual: nothing may ever *set* it (Postgres rejects writes to a generated column), yet the type invites it. And every read needs a null guard even though the column can never actually be null.

**Rule:** Never pass a generated column in an `Insert`/`Update` payload — let the column derive it (`moves` is stored raw; `moves_normalized` follows). On read, guard the null before using it as a `string` (`source.moves_normalized ?? ""`), and keep a parity test between the SQL definition and any JS twin of the same rule.

**Applies to:** Every Postgres generated column surfaced through Supabase-generated types, and any JS function duplicating a SQL-side derivation.

## Playwright serves the built worker — rebuild before E2E, and clean up your own rows

**Context:** playwright.config.ts:26-33 — `webServer.command` is `npm run build && npm run preview`, not `astro dev`

**Problem:** Two traps follow from that choice (itself forced: the Cloudflare workerd dev runtime loads two copies of React and the client island crashes on `useReducer`). First, `preview` serves `dist/`, so **app-code changes are invisible to E2E until a rebuild** — a spec can pass or fail against the previous build and the result means nothing. Second, the specs authenticate against the **remote** Supabase project via a pre-captured `playwright/.auth/user.json` and have no teardown, so every run leaves real rows in a shared database.

**Rule:** Never diagnose an E2E result without confirming `dist/` includes the change (the config's own `build &&` covers a normal `npm run test:e2e`; a hand-run `npx playwright test <file>` against an already-running `preview` does not). Give every E2E-created row a unique timestamped identifier and add an explicit sweep step for leftovers — the harness will not clean up after you.

**Applies to:** All Playwright work in this repo, and any E2E suite whose web server serves a build artifact or whose fixtures write to a shared remote environment.

## Local `db reset` seeds 8 algorithms; the remote project has 127

**Context:** supabase/config.toml:65 (`sql_paths = ["./seed.sql"]`) vs supabase/algos_seed.sql (F2L/OLL/full-PLL, 119 rows across 3 more system lists)

**Problem:** `npx supabase db reset` loads `seed.sql` only — 8 two-look PLL rows, none with parenthesised grouping. `algos_seed.sql` is not in `sql_paths` and never runs locally. So a query against a pre-built algorithm, a duplicate match on a seeded sequence, or anything touching notation with parens can behave one way locally and another way against the remote project, with no error to signal the gap.

**Rule:** When a test or manual check depends on seeded content, state which corpus it assumes. Do not conclude "no pre-built match exists" from a local run — verify against the remote row set, or add the row the test needs as an explicit fixture rather than leaning on the seed.

**Applies to:** Integration tests and manual verification steps that read `is_system` lists or their algorithms; any assertion about duplicate detection against pre-built sequences.

## Never use a value assertion as a hydration probe

- **Context**: Any Playwright spec that types into a form rendered by an Astro `client:*` island (`auth.setup.ts`, `CreateListForm`, `AddAlgorithmForm`), and any E2E readiness check on a partially-hydrated page.
- **Problem**: A `fill` before hydration writes the DOM value but never reaches React state, and React 19 leaves that existing value alone when it mounts a controlled input — so `toHaveValue` passes while state is still `""`. The submit then fails validation with an empty-field error that reads as an app bug. `auth.setup.ts` flaked this way intermittently ("Email is required" with the password visibly filled); both add-algorithm fields hit it on the first run of the custom-list spec. The deeper cause: the `expect(...).toPass()` retry could never converge, because its condition was already satisfied by the broken state.
- **Rule**: Never treat a value assertion as proof that a controlled input is hydrated — wait on the framework's own hydration signal (zero `astro-island[ssr]` nodes; the custom element drops the attribute after its hydrator resolves). More generally: a retry loop whose condition is satisfiable by the broken state proves nothing.
- **Applies to**: e2e, implement, impl-review
