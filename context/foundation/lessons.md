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

## A DB error message is for the log, not the page — and never for a URL

- **Context**: Any server-rendered Astro page that awaits a Supabase/PostgREST query and has an error branch — `dashboard.astro`, `sets/[id].astro`, `sets/[id]/[algoId].astro`. Applies to the value put in a rendered error banner and, more sharply, to anything interpolated into an `Astro.redirect("...?error=" + ...)` query string.
- **Problem**: A PostgREST message names columns, tables, and sometimes the policy that rejected the read; `.single()` on zero rows adds "JSON object requested, multiple (or no) rows returned", which is both a leak and meaningless to a learner. The lib modules already refuse to echo it (`createList.ts:57-61`, asserted by `createList.test.ts:95-103`), so the two layers drifted apart and stayed that way: commit c29f2f3 deliberately added `bannerError = listError.message` to `sets/[id].astro` for "honest error redirects", and the 2026-08-26 impl review (F10) then found the same line as a leak. Without a written rule the decision flips on each review. A redirect is the worse half — the string lands in browser history and any proxy log.
- **Rule**: In an Astro page's query-error branch, `console.error` the error object and assign the banner a fixed, human-readable string; never assign `error.message` and never interpolate it into a redirect URL. Collapse "query failed" and "`.single()` found no row" to the same generic message on purpose — the caller must not be able to tell them apart. Supabase **Auth** messages ("Invalid login credentials", `signin.ts:16`) are exempt: they are user-facing by design and carry no schema detail.
- **Applies to**: implement, impl-review

## The shadcn tokens are light-mode here — a variant without an explicit foreground is invisible

- **Context**: Every `src/components/ui/*` primitive whose variants lean on shadcn's semantic tokens (`bg-background`, `text-primary`, `bg-accent`, `text-accent-foreground`), and every app surface that renders one — all of them, since `AppLayout.astro:15` and the auth pages both paint `bg-cosmic` + `text-white`.
- **Problem**: `global.css` defines the dark palette under `.dark` and gates the variant on `&:is(.dark *)`, but **nothing in this app ever sets that class** — not `<html>`, not `<body>`, not any wrapper. So every token resolves to its `:root` (light) value while the page underneath is dark. `button.tsx`'s `outline` variant inherited exactly this: `bg-background` came out white, the variant set no foreground, the label inherited `text-white` from the layout, and the result was white-on-white — legible **only on hover**, once `hover:text-accent-foreground` supplied a dark color. It shipped that way through three call sites (`Retry`, `Try Again`, `Create separate entry`) before a fourth (`Cancel`) got it noticed. The `dark:` half of each variant string is dead code and reads as if the case were handled. `link` (`text-primary` → near-black on cosmic) carries the same latent defect, unused so far.
- **Rule**: Never trust a shadcn variant's token defaults in this repo, and never read a `dark:` utility as evidence the dark case is covered — there is no `.dark` ancestor to activate it. A variant must state its own surface **and** its own foreground, in the app's translucent-white idiom (`border-white/20 bg-white/10 text-white`); a variant that sets a background without a paired text color is the bug. Check the non-hover state specifically: a hover rule that supplies the missing color hides the defect from anyone testing with a mouse. Prefer fixing the one variant over adding `class="dark"` globally — that flips `default` to a near-white surface and restyles every primary CTA in the app.
- **Applies to**: implement, impl-review, e2e
