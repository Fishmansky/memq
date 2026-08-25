---
title: "MemQ — Anti-Corruption Layer: refactor plan for the leaking Supabase dependency"
created: 2026-08-25
type: refactor-plan
---

# From SDK-everywhere to one seam — the Supabase Anti-Corruption Layer

> This document is a **PLAN**, not an implementation. No production code was
> modified. Every `file:line` citation was verified against the working tree on
> `master` at 2026-08-25.
> Companions: `context/domain/01-domain-distillation.md` (domain map),
> `context/domain/02-invariant-aggregate-refactor.md` (the `PracticeAttempt`
> guardian aggregate). Sequencing against 02 is settled in Step 6.

---

## Step 0 — Context discovery

### Baseline documents that exist

| Document | Path | What it contributes here |
|---|---|---|
| PRD (v1, `status: draft`) | `context/foundation/prd.md` | NFRs `:110-111`, Business Logic `:113-121`, Access Control `:123-125`, Non-Goals `:127-133`, Open Questions `:135-137` |
| Tech stack hand-off | `context/foundation/tech-stack.md` | frontmatter `:1-17`; rationale `:21` names Supabase for auth + RLS + Postgres |
| Infrastructure research | `context/foundation/infrastructure.md` | `database: Supabase (external, PostgreSQL + Auth)` `:12`; `@supabase/ssr` is mandatory on workerd `:76`; runtime pre-mortem `:67-71` |
| Test plan | `context/foundation/test-plan.md` | the seam rule `:195-200`; "NEVER from the app's `@/lib/supabase`" `:176`; negative space `:257-259` |
| Roadmap (`status: active`) | `context/foundation/roadmap.md` | F-01/S-01/S-02 `done`; S-03 `progress-tracking` and S-04 `custom-list-algorithm-entry` still `ready` `:35-36` |
| Lessons register | `context/foundation/lessons.md` | `:5-13` — "Run independent Supabase queries concurrently with `Promise.all`" |
| Repo rules | `AGENTS.md`, `README.md` | `@/*` alias; **never hardcode `SUPABASE_URL`/`SUPABASE_KEY`**; three runners, no fourth |

### Statements about replaceability / separation

There is no sentence anywhere that says "Supabase must be swappable". What the
documents *do* declare is a **separation of concerns** that the code then
violates:

1. **`infrastructure.md:12`** — `database: Supabase (external, PostgreSQL + Auth)`.
   The word *external* is load-bearing: it is repeated at `:39`
   ("irrelevant since Supabase is external") to argue that the hosting decision
   and the data decision are independent axes. A dependency modelled as an
   external, independently-chosen service that is nonetheless hand-written into
   eight route/page bodies is not external in any operational sense.
2. **`test-plan.md:195-200`** — the project's own rule for new endpoints:
   *"Lift its logic into a node-importable function that takes an **injected**
   Supabase client and returns a structured result the route maps to a
   `Response`."* This is dependency **injection** without dependency
   **inversion**: the seam is real (`completePractice.ts`), but the thing being
   injected is the vendor's own class, so the seam buys testability and buys
   nothing else.
3. **`test-plan.md:176`** — *"Both built directly from `@supabase/supabase-js` +
   `process.env` — **NEVER** from the app's `@/lib/supabase`."* The project has
   already identified that `@/lib/supabase` is a leaky construction point — but
   the remedy applied was "test code must route around it", not "give the app a
   port".

The intention-vs-code gap is therefore documented and specific: the docs treat
data access as an injectable, external, structured-result concern; the code
treats it as an ambient SDK.

### Stack and layers

Astro 6 (`output: "server"`, Cloudflare adapter — `astro.config.mjs:10-26`) +
React 19 islands + TypeScript strict + Tailwind v4 + Supabase + Cloudflare
Workers. Env is declared through `astro:env` as **server-only secrets**
(`astro.config.mjs:20-25`), both `optional: true`.

| Layer | Representative files |
|---|---|
| Ambient global types | `src/env.d.ts` |
| Middleware / session | `src/middleware.ts` |
| SSR pages (UI + data) | `src/pages/dashboard.astro`, `src/pages/sets/[id].astro`, `src/pages/sets/[id]/[algoId].astro` |
| Astro components (UI) | `src/components/Topbar.astro`, `src/components/app/*.astro` |
| API routes (wire) | `src/pages/api/auth/{signin,signup,signout}.ts`, `src/pages/api/practice/complete.ts` |
| Domain-ish modules | `src/lib/practice/completePractice.ts`, `src/lib/practice/streak.ts` |
| Client island (browser bundle) | `src/components/app/PracticeSession.tsx` |
| Infrastructure | `src/lib/supabase.ts`, `src/db/database.types.ts` |
| Persistence rules | `supabase/migrations/20260527000000_domain_schema_rls.sql` |
| Tests | `src/test/**`, `src/lib/**/*.test.ts*`, `playwright/test/**` |

### External runtime dependencies (from the manifest)

`package.json:20-42` — the candidates that can even *have* a boundary problem:
`@supabase/ssr:27`, `@supabase/supabase-js:28`, `react-hotkeys-hook:38`,
`@astrojs/cloudflare`, `@radix-ui/react-slot`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `lucide-react`.

---

## Step 1 — Identified leaking dependencies

### Axis A — `@supabase/supabase-js` + `@supabase/ssr`

Every file that knows this dependency **today**. "Knows" = imports it, imports
the app's construction wrapper, hand-writes its query DSL, reads a field only it
produces, or consumes one of its types.

| # | File:line | How it knows | Layer |
|---|---|---|---|
| 1 | `src/lib/supabase.ts:1` | `import { createServerClient, parseCookieHeader } from "@supabase/ssr"` | infra |
| 2 | `src/lib/supabase.ts:10-24` | builds the client; hand-wires `cookies.getAll/setAll` | infra |
| 3 | `src/env.d.ts:3` | `user: import("@supabase/supabase-js").User \| null` — **the vendor's type in the global ambient namespace** | global types |
| 4 | `src/middleware.ts:2,7` | imports + calls `createClient` | middleware |
| 5 | `src/middleware.ts:10-13` | `supabase.auth.getUser()` destructured as `{ data: { user } }` | middleware |
| 6 | `src/components/Topbar.astro:2,11` | renders `user.email` off the vendor's `User` (via ambient `App.Locals`) | **UI** |
| 7 | `src/pages/dashboard.astro:4,6` | imports + calls `createClient` | **UI/SSR** |
| 8 | `src/pages/dashboard.astro:15-19` | `.from("algorithm_lists").select("id, name").eq("is_system", true).order(...)` | **UI/SSR** |
| 9 | `src/pages/dashboard.astro:22` | `queryError = error.message` — vendor error string → banner `:33-37` | **UI** |
| 10 | `src/pages/sets/[id].astro:4,12` | imports + calls `createClient` | **UI/SSR** |
| 11 | `src/pages/sets/[id].astro:19-23` | `.from("algorithm_lists").select("id, name").eq("id", id).single()` | **UI/SSR** |
| 12 | `src/pages/sets/[id].astro:29-33` | `.from("algorithms").select("id, name, position").eq("list_id", id).order(...)` | **UI/SSR** |
| 13 | `src/pages/sets/[id].astro:26,36` | `listError.message` / `algoError?.message` → banner `:47-51` | **UI** |
| 14 | `src/pages/sets/[id]/[algoId].astro:4,16` | imports + calls `createClient` | **UI/SSR** |
| 15 | `src/pages/sets/[id]/[algoId].astro:23-28` | `.from("algorithms").select("id, name, moves").eq("id", algoId).eq("list_id", id).single()` | **UI/SSR** |
| 16 | `src/pages/sets/[id]/[algoId].astro:36-40` | `.from("algorithm_lists").select("id, name").eq("id", id).single()` — **duplicate of #11** | **UI/SSR** |
| 17 | `src/pages/sets/[id]/[algoId].astro:33,45` | `algoError.message` / `listError.message` → banner `:60-65` | **UI** |
| 18 | `src/pages/api/auth/signin.ts:2,9` | imports + calls `createClient` | wire |
| 19 | `src/pages/api/auth/signin.ts:13` | `supabase.auth.signInWithPassword({ email, password })` | wire |
| 20 | `src/pages/api/auth/signin.ts:16` | `encodeURIComponent(error.message)` — **vendor `AuthError.message` becomes a URL query parameter** | wire→UI |
| 21 | `src/pages/api/auth/signup.ts:2,9,13,16` | same four leaks for `signUp` | wire→UI |
| 22 | `src/pages/api/auth/signout.ts:2,5-8` | imports + calls `createClient`; `supabase.auth.signOut()` | wire |
| 23 | `src/pages/api/practice/complete.ts:2,43` | imports + calls `createClient` | wire |
| 24 | `src/pages/api/practice/complete.ts:44-49` | `if (!supabase)` → `500 { error: "Supabase not configured" }` — **the vendor's name in a wire contract** | wire |
| 25 | `src/pages/api/practice/complete.ts:6,51` | passes ambient-typed `locals.user` straight into the domain call | wire |
| 26 | `src/lib/practice/completePractice.ts:12` | `import type { SupabaseClient } from "@supabase/supabase-js"` | **domain** |
| 27 | `src/lib/practice/completePractice.ts:46` | `supabase: SupabaseClient<Database>` — **the vendor's class in a domain function signature** | **domain** |
| 28 | `src/lib/practice/completePractice.ts:52-93` | three hand-written query chains (`insert`, `select().eq().eq().maybeSingle()`, `upsert(..., { onConflict })`) | **domain** |
| 29 | `src/lib/practice/completePractice.ts:69` | `sessionResult.error.code === "23503"` — **a raw Postgres SQLSTATE as a domain branch** | **domain** |
| 30 | `src/lib/practice/completePractice.test.ts:2,27-46` | **rebuilds the fluent-chain shape by hand**, then `as unknown as SupabaseClient<Database>` `:46` | unit test |
| 31 | `src/db/database.types.ts:12-14,162` | `__InternalSupabase: { PostgrestVersion: "14.5" }`; `Omit<Database, "__InternalSupabase">` | generated types |
| 32 | `src/test/integration/db.ts:11,21,28,32,51,59,75` | `createClient`, `SupabaseClient<Database>` in seven signatures | integration test |
| 33 | `src/test/integration/{persistence,streak,smoke}.int.test.ts:2` | `import type { SupabaseClient }` in three spec files | integration test |

**Count: 16 files under `src/` import `@supabase/*` or `@/lib/supabase`**
(`grep -rln "@/lib/supabase\|@supabase/" src/` → 16), **plus**
`src/components/Topbar.astro`, which consumes the vendor's `User` with no import
at all because `src/env.d.ts:3` put it in the ambient global namespace. Seventeen
knowing sites across **seven** layers: global types, middleware, SSR pages, UI
components, wire routes, the one domain module, and all three test suites.

### Axis B — `react-hotkeys-hook`

| File:line | How it knows |
|---|---|
| `src/components/app/PracticeSession.tsx:2` | `import { useHotkeys } from "react-hotkeys-hook"` |
| `src/components/app/PracticeSession.tsx:8-35` | `KEY_TO_MOVE` — its **keys** are the library's combo-string DSL (`"shift+r"`), its values are domain move tokens |
| `src/components/app/PracticeSession.tsx:298-315` | reads the library's `handler.keys` / `handler.shift` and re-assembles the combo string `:301-303` to look the move back up |
| `src/test/tokenGrammar.ts:1,14-16` | derives `KEYBOARD_BASE_TOKENS` — and therefore `PRODUCIBLE_TOKENS` `:27-30`, the **domain grammar** — from that same library-shaped table |

One runtime import, but the library's key-notation dictates the shape of the
table from which the domain's producible-token set is computed, and that set is
the oracle for `src/test/seedTokens.test.ts` and
`src/components/app/PracticeSession.parity.test.ts`.

### Axis C — `astro:env/server`

`src/lib/supabase.ts:3` and `src/lib/config-status.ts:1`. Two files. It is the
framework's own virtual module, not a swappable vendor — but note its
consequence: because `completePractice.ts` must avoid it to stay
node-importable (`test-plan.md:195-197`), *avoiding this import* is the reason
the vendor client is passed around as a parameter in the first place.

### Axis D — presentation libraries

`clsx` + `tailwind-merge` are already behind one function (`src/lib/utils.ts:4-6`);
`class-variance-authority` / `@radix-ui/react-slot` are confined to
`src/components/ui/button.tsx`. **These are the counter-example**: a single
knowing file each. They show the pattern this repo is capable of and did not
apply to its most important dependency.

---

## Step 2 — Classification, and the pick

| Axis | (a) layers / files touched | (b) cost of replacing it today | (c) documented intent vs. code | Verdict |
|---|---|---|---|---|
| **A — `@supabase/*`** | **7 layers, 17 files**, incl. one domain signature, one ambient global type, three UI pages, one wire error body | **Extreme.** A swap edits every page body, both auth routes, the domain function, the ambient `App.Locals`, the unit-test stub, and every integration signature. There is no single file whose replacement would suffice. | Docs call it *external* (`infrastructure.md:12`) and prescribe injected clients + structured results (`test-plan.md:195-200`), and already warn tests off the construction point (`:176`). Code puts the SDK in the UI. **Largest gap.** | **#1 — refactor this** |
| B — `react-hotkeys-hook` | 2 files, but reaches domain grammar via `tokenGrammar.ts` | Moderate — rewrite `KEY_TO_MOVE`'s keys and the `handler`-reading callback | none stated | #2 |
| C — `astro:env/server` | 2 files | Low (framework-owned) | n/a | #3 |
| D — `clsx` / `cva` / radix | 1 file each | Low | already isolated | no action |

**Chosen: Axis A — `@supabase/supabase-js` + `@supabase/ssr`.**

Justification, in the order the criteria were weighed:

- **(a)** It is the only dependency present in more than two layers, and the only
  one that reaches *both* the browser-facing rendering layer and the domain
  layer. Axis B is one import; Axis A is seventeen sites.
- **(b)** Replacement cost is not merely "many files" — it is *unbounded by
  design*, because there is no place that owns the mapping. Nothing in the
  codebase can tell you what the full set of Supabase-shaped assumptions is; you
  have to grep and read. The `.astro` pages are the worst of it: data-access
  knowledge in a template file cannot be unit-tested under the project's own
  rules (`test-plan.md:195-197` — Astro pages "won't load under node"), so the
  leak also puts that logic permanently out of reach of two of the three runners.
- **(c)** The gap is documented and quotable, which makes it a *drift*, not a
  preference: `test-plan.md:195-200` describes exactly the inversion that was
  half-built, and `test-plan.md:176` records that the team already had to work
  around the construction point rather than fix it.

Axis B is real and worth a follow-up, but it corrupts one bounded thing (the
input-notation table) and the fix is local. Axis A corrupts the shape of the
whole application.

---

## Step 3 — Diagnosis

### 3.1 Duplication: the same query, written twice

`src/pages/sets/[id].astro:19-23`

```ts
  const { data: listData, error: listError } = await supabase
    .from("algorithm_lists")
    .select("id, name")
    .eq("id", id)
    .single();
```

`src/pages/sets/[id]/[algoId].astro:36-40`

```ts
  const { data: listData, error: listError } = await supabase
    .from("algorithm_lists")
    .select("id, name")
    .eq("id", id)
    .single();
```

Character-for-character identical, in two files, with no shared home. Any change
to how a set is fetched — a column, an ordering guarantee, a soft-delete filter,
a `Promise.all` — has to be discovered in both.

### 3.2 Duplication: the null-client guard, eight times

`src/lib/supabase.ts:7-9` returns `null` when either secret is absent
(both are `optional: true` — `astro.config.mjs:22-23`). Every caller then
re-invents the missing-config branch, and each invents a *different* answer:

| Site | Its answer to "no client" |
|---|---|
| `src/middleware.ts:14-15` | `locals.user = null` (silently unauthenticated) |
| `src/pages/dashboard.astro:14` | skip the `if`; render "No pre-built sets found." `:41` |
| `src/pages/sets/[id].astro:18,40-42` | fall through to `!list` → redirect with `"Set not found"` |
| `src/pages/sets/[id]/[algoId].astro:22,49-51` | redirect with `"Algorithm not found"` |
| `src/pages/api/auth/signin.ts:10-12` | redirect, `?error=Supabase is not configured` |
| `src/pages/api/auth/signup.ts:10-12` | same string, duplicated |
| `src/pages/api/auth/signout.ts:6` | `if (supabase)` — silently succeed |
| `src/pages/api/practice/complete.ts:44-49` | `500 { error: "Supabase not configured" }` |

A misconfigured deployment tells a learner "Set not found" on one page,
"No pre-built sets found." on another, and leaks the vendor's name into a JSON
error body on a third. This is not eight bugs; it is one missing concept
(*the store is unavailable*) that has nowhere to live.

### 3.3 Duplication: the SDK's fluent chain, rebuilt in a test

`src/lib/practice/completePractice.test.ts:27-46`

```ts
function makeStub(config: StubConfig): SupabaseClient<Database> {
  const stub = {
    from() {
      return {
        insert: () => Promise.resolve({ error: config.insertError ?? null }),
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => /* … */ }) }) }),
        upsert: () => Promise.resolve({ error: config.upsertError ?? null }),
      };
    },
  };
  return stub as unknown as SupabaseClient<Database>;
}
```

The unit test for a **domain rule** has to model PostgREST's builder shape —
two nested `.eq()` calls deep — and then defeat the type system with
`as unknown as` (`:46`) to hand it over. The comment at `:23-26` is an accurate
description of the problem: the test's subject is the streak rule, and its
subject matter is the vendor's call chain.

### 3.4 Boundary crossing: vendor types in the global ambient namespace

`src/env.d.ts:1-5`

```ts
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}
```

This is the most consequential leak, because it is the one nobody has to import
to be affected by. `App.Locals` is ambient: **every** `.astro` file and every
Astro-aware module in the project now has a Supabase type in scope. The UI
consumes it directly at `src/components/Topbar.astro:2,11`:

```ts
const { user } = Astro.locals;   // :2
…
<span class="text-blue-100/70">{user.email}</span>   {/* :11 */}
```

`Topbar.astro` renders a Supabase `User`. It needs exactly one field. It is typed
against a class carrying `app_metadata`, `user_metadata`, `identities`, `aud`,
`confirmed_at`, `factors`, and more — none of which are MemQ concepts, all of
which are now legal to reach for from any template.

**On bundle risk — stated precisely, not inflated:** this particular leak is
`import type`, and `Topbar.astro` is a server-rendered component, so **no
Supabase code reaches the browser bundle today**. I verified there is no
`createBrowserClient` and no `@supabase/*` import anywhere under
`src/components/` — `PracticeSession.tsx` talks to the server over `fetch`
(`:324-329`) and is clean. The danger is not current weight, it is that the
ambient type makes the *next* leak frictionless: an island that accepts
`user={Astro.locals.user}` as a prop type-checks immediately, and serializing a
Supabase `User` into island props ships the whole identity object — including
`app_metadata` — into the page's HTML. The guardrail against that is a domain
type, not vigilance.

### 3.5 Boundary crossing: vendor error strings on the wire and in the UI

`src/pages/api/auth/signin.ts:15-17` (identical at `signup.ts:15-17`)

```ts
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }
```

The message is produced by Supabase's Go auth server, in English, and lands in a
UI whose own copy is Polish (`src/lib/config-status.ts:15`). The wire contract of
`/api/auth/signin` is, literally, *"whatever string GoTrue chose"*. Same pattern
on the data side: `dashboard.astro:22`, `sets/[id].astro:26,36`,
`[algoId].astro:33,45` all assign a `PostgrestError.message` to `bannerError`
and render it verbatim.

### 3.6 Boundary crossing: a SQLSTATE as a domain branch

`src/lib/practice/completePractice.ts:67-74`

```ts
  if (sessionResult.error) {
    // FK violation = unknown/invalid algorithmId → client error, not server fault.
    if (sessionResult.error.code === "23503") {
      return { status: 400, body: { error: "Invalid algorithmId" } };
    }
```

The comment is doing the translation work that a type should be doing. `"23503"`
is Postgres's `foreign_key_violation`. The module that owns MemQ's streak rule
must know a Postgres error catalogue to decide between 400 and 500 — and the
knowledge is a bare string literal, with the mapping to a domain meaning living
only in a comment. Note also `:46`: the vendor's class is in the signature of
the file the project calls its domain seam.

### 3.7 The leak defeats the project's own lessons register

`context/foundation/lessons.md:5-13` records the rule *"When a page needs data
from two independent queries, use `Promise.all([query1, query2])"*, and names
`src/pages/sets/[id]/[algoId].astro` as its context. That page today awaits its
two independent reads **sequentially** — `:23-28` then `:36-40`. The lesson is
correct and unapplied, because there is no single place where "fetch the
practice context" is implemented; the rule has to be re-remembered at every call
site. A port has one implementation, and the lesson gets applied once.

### 3.8 What the docs promised, and what the code does

| Documented intent | `file:line` | Code reality |
|---|---|---|
| "database: Supabase (**external**, PostgreSQL + Auth)" | `infrastructure.md:12` | hand-written PostgREST chains in three `.astro` templates |
| "Lift its logic into a node-importable function that takes an **injected** Supabase client and returns a structured result" | `test-plan.md:195-198` | done once (`completePractice.ts`), and what is injected is `SupabaseClient<Database>` — injection without inversion |
| "**NEVER** from the app's `@/lib/supabase`" | `test-plan.md:176` | the construction point is known-leaky; tests route around it instead of it being fixed |
| "Auth pages and flows — Supabase Auth … own sign-in/sign-up/session; **not our logic**" | `test-plan.md:257` | `signin.ts:16` / `signup.ts:16` make Supabase's error copy *our* wire contract and *our* UI copy |

---

## Step 4 — ACL design

Two new directories. Everything else in the app imports only from the first.

```
src/lib/domain/
  identity/       Learner, LearnerId, EmailAddress
  catalog/        AlgorithmSet, Algorithm, SetId, AlgorithmId
  practice/       MasteryState  (+ existing streak.ts; MoveSequence per doc 02)
  errors.ts       the domain failure vocabulary
  ports.ts        AlgorithmCatalog, IdentityGateway, PracticeStore

src/lib/adapters/supabase/          ← THE ONLY PLACE @supabase/* MAY APPEAR
  client.ts            createServerClient + cookie plumbing (moved from lib/supabase.ts)
  errorTranslation.ts  PostgrestError.code / AuthError.code  →  domain errors
  rowMapping.ts        Database["public"]["Tables"][…]["Row"]  →  domain objects
  SupabaseAlgorithmCatalog.ts
  SupabaseIdentityGateway.ts
  SupabasePracticeStore.ts
  unavailable.ts       the "secrets absent" implementations of all three ports
  index.ts             the single factory the app calls
```

### 4.1 The value objects — one place that knows each shape

`Learner` replaces the vendor's `User` everywhere, including in the ambient
`App.Locals`. It is the only identity shape MemQ has.

```ts
// src/lib/domain/identity/Learner.ts
export type LearnerId = string & { readonly __brand: "LearnerId" };

export class EmailAddress {
  private constructor(readonly value: string) {}
  static parse(raw: string): EmailAddress;      // throws InvalidEmailError
  toString(): string;
}

export class Learner {
  private constructor(readonly id: LearnerId, readonly email: EmailAddress) {}

  /** The ONLY conversion from the identity provider's payload. */
  static fromProviderClaims(claims: { id: string; email?: string | null }): Learner;
  //   throws IncompleteIdentityError when the provider omits an email

  /** What a template is allowed to see. */
  displayName(): string;                        // = email.toString(), today
}
```

```
fromProviderClaims(claims):
    if not claims.id                -> throw IncompleteIdentityError("id")
    if not claims.email             -> throw IncompleteIdentityError("email")
    return new Learner(claims.id as LearnerId, EmailAddress.parse(claims.email))

# Note what is NOT carried across: app_metadata, user_metadata, identities,
# aud, factors, confirmed_at. If a MemQ rule ever needs one, it is added here
# explicitly, as a named domain concept — never read off the wire object.
```

`AlgorithmSet` / `Algorithm` are the catalog side. `Algorithm` is where doc 02's
`MoveSequence` is constructed, so INV-08/INV-09 are enforced at the boundary
rather than trusted:

```ts
// src/lib/domain/catalog/Algorithm.ts
export type SetId = string & { readonly __brand: "SetId" };
export type AlgorithmId = string & { readonly __brand: "AlgorithmId" };

export class AlgorithmSet {
  private constructor(readonly id: SetId, readonly name: string, readonly isSystem: boolean) {}
  static fromRow(row: { id: string; name: string; is_system?: boolean }): AlgorithmSet;
}

export class Algorithm {
  private constructor(
    readonly id: AlgorithmId,
    readonly name: string,
    readonly position: number,
    readonly sequence: MoveSequence,      // doc 02
  ) {}
  static fromRow(row: { id: string; name: string; position: number; moves: string }): Algorithm;
  //   throws UnknownMoveTokenError | EmptySequenceError  (INV-08 / INV-09, fail-fast)
}
```

```
Algorithm.fromRow(row):
    seq = MoveSequence.parse(row.moves)        # single tokenizer; INV-08, INV-09
    return new Algorithm(row.id, row.name, row.position, seq)

# snake_case → camelCase, string → MoveSequence, and the token-validity check
# all happen HERE. `moves: string` never escapes the ACL. Today the raw column
# value is handed to a React island as a prop
# (src/pages/sets/[id]/[algoId].astro:67) and re-tokenized in the browser
# (PracticeSession.tsx:216-218, duplicated at MoveSequence.astro:7).
```

`MasteryState` gives the practice side a return type that is not a row:

```ts
// src/lib/domain/practice/MasteryState.ts
export class MasteryState {
  private constructor(readonly consecutiveClean: number, readonly masteryReached: boolean) {}
  static fromRow(row: { consecutive_clean: number; mastery_reached: boolean } | null): MasteryState;
  static initial(): MasteryState;               // the `?? 0` / `?? false` today at completePractice.ts:81-82
  next(isClean: boolean): MasteryState;         // delegates to computeStreak (streak.ts:22-25, unchanged)
}
```

### 4.2 The failure vocabulary — no vendor code, no SQLSTATE, no vendor string

```ts
// src/lib/domain/errors.ts
export class SetNotFound        extends Error { constructor(readonly setId: SetId) {…} }
export class AlgorithmNotFound  extends Error { constructor(readonly algorithmId: AlgorithmId) {…} }
export class UnknownAlgorithmReferenced extends Error { … }   // was SQLSTATE 23503
export class StoreUnavailable   extends Error { constructor(readonly cause?: unknown) {…} }
export class StoreNotConfigured extends Error {}              // secrets absent
export class InvalidEmailError | IncompleteIdentityError extends Error { … }

export type SignInFailure =
  | { reason: "invalid_credentials" }
  | { reason: "email_not_confirmed" }
  | { reason: "rate_limited"; retryAfterSeconds?: number }
  | { reason: "provider_unavailable" };

export type SignUpFailure =
  | { reason: "email_already_registered" }
  | { reason: "weak_password" }
  | { reason: "email_invalid" }
  | { reason: "signup_disabled" }
  | { reason: "rate_limited"; retryAfterSeconds?: number }
  | { reason: "provider_unavailable" };
```

`reason` is a MemQ enum. The mapping from provider codes to it lives in exactly
one file (§4.4), and the mapping from `reason` to user-facing copy lives in the
UI — which is where translated copy belongs, next to `config-status.ts:15`.

### 4.3 The narrow ports

Three, split by use case rather than one god-repository — so no consumer can
reach an operation it has no business calling.

```ts
// src/lib/domain/ports.ts

export interface AlgorithmCatalog {
  /** dashboard.astro */
  listSystemSets(): Promise<AlgorithmSet[]>;                    // throws StoreUnavailable | StoreNotConfigured

  /** sets/[id].astro — one call, one round trip pair */
  loadSet(setId: SetId): Promise<{ set: AlgorithmSet; algorithms: Algorithm[] }>;
  //   throws SetNotFound | StoreUnavailable | StoreNotConfigured

  /** sets/[id]/[algoId].astro — replaces the two sequential awaits (lessons.md:5-13) */
  loadPracticeContext(setId: SetId, algorithmId: AlgorithmId):
    Promise<{ set: AlgorithmSet; algorithm: Algorithm }>;
  //   throws SetNotFound | AlgorithmNotFound | UnknownMoveTokenError | StoreUnavailable
}

export interface IdentityGateway {
  /** middleware.ts */
  currentLearner(): Promise<Learner | null>;                    // never throws on "not signed in"
  signIn(email: string, password: string): Promise<Result<Learner, SignInFailure>>;
  signUp(email: string, password: string): Promise<Result<{ needsEmailConfirmation: boolean }, SignUpFailure>>;
  signOut(): Promise<void>;                                     // idempotent; never throws
}

export interface PracticeStore {
  readMastery(learnerId: LearnerId, algorithmId: AlgorithmId): Promise<MasteryState>;
  recordSession(args: {
    learnerId: LearnerId; algorithmId: AlgorithmId; isClean: boolean; errorCount: number;
  }): Promise<void>;
  //   throws UnknownAlgorithmReferenced | StoreUnavailable
  writeMastery(learnerId: LearnerId, algorithmId: AlgorithmId, state: MasteryState): Promise<void>;
  //   throws StoreUnavailable
}
```

Not in any port: `Database`, `SupabaseClient`, `PostgrestError`, `AuthError`,
`User`, `Session`, `.from()`, `.eq()`, `onConflict`, `"23503"`, `"PGRST116"`.
Nothing snake_case. No HTTP status, no `Response`.

> **Relationship to doc 02.** `PracticeStore` is the primitive, non-atomic shape
> that matches the code as it stands today, so this refactor is behaviour-neutral
> and independently shippable. Doc 02 replaces those three methods with a single
> atomic `PracticeAttemptRepository.record(attempt, verdict)` backed by an RPC
> (`02-invariant-aggregate-refactor.md:289-296`). That is a **narrowing of the same port**, in the same directory,
> visible to the same one adapter — see Step 6 for the ordering.

### 4.4 The adapters, and the single translation table

```ts
// src/lib/adapters/supabase/errorTranslation.ts
// THE ONLY FILE THAT KNOWS WHAT A POSTGREST OR GOTRUE ERROR IS.
import type { PostgrestError, AuthError } from "@supabase/supabase-js";

export function translateRead(err: PostgrestError, ctx: ReadContext): never { … }
export function translateWrite(err: PostgrestError, ctx: WriteContext): never { … }
export function translateSignIn(err: AuthError): SignInFailure { … }
export function translateSignUp(err: AuthError): SignUpFailure { … }
```

```
translateRead(err, ctx):
    if err.code == "PGRST116" and ctx.kind == "by-id":
        # zero rows OR RLS-invisible; see §5.3 — verified against postgrest-js
        throw ctx.target == "set" ? new SetNotFound(ctx.id) : new AlgorithmNotFound(ctx.id)
    throw new StoreUnavailable(err)          # never surface err.message

translateWrite(err, ctx):
    if err.code == "23503": throw new UnknownAlgorithmReferenced(ctx.algorithmId)
    if err.code == "23505": throw new DuplicateRecord(ctx)       # room for doc 02's attempt_id UNIQUE
    throw new StoreUnavailable(err)

translateSignIn(err):
    switch err.code:
      "invalid_credentials", "user_not_found" -> { reason: "invalid_credentials" }   # collapsed on purpose
      "email_not_confirmed"                   -> { reason: "email_not_confirmed" }
      "over_request_rate_limit"               -> { reason: "rate_limited" }
      default                                  -> { reason: "provider_unavailable" }

translateSignUp(err):
    switch err.code:
      "email_exists", "user_already_exists"   -> { reason: "email_already_registered" }
      "weak_password"                          -> { reason: "weak_password" }
      "email_address_invalid"                  -> { reason: "email_invalid" }
      "signup_disabled"                        -> { reason: "signup_disabled" }
      "over_email_send_rate_limit"             -> { reason: "rate_limited" }
      default                                  -> { reason: "provider_unavailable" }
```

The catalog adapter, showing where the duplicated query and the unapplied lesson
both land:

```ts
// src/lib/adapters/supabase/SupabaseAlgorithmCatalog.ts
export class SupabaseAlgorithmCatalog implements AlgorithmCatalog {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async loadPracticeContext(setId, algorithmId) {
    const [algo, set] = await Promise.all([        // lessons.md:5-13, applied once
      this.db.from("algorithms").select("id, name, position, moves")
        .eq("id", algorithmId).eq("list_id", setId).single(),
      this.db.from("algorithm_lists").select("id, name, is_system")
        .eq("id", setId).single(),
    ]);
    if (algo.error) translateRead(algo.error, { kind: "by-id", target: "algorithm", id: algorithmId });
    if (set.error)  translateRead(set.error,  { kind: "by-id", target: "set",       id: setId });
    return { set: AlgorithmSet.fromRow(set.data), algorithm: Algorithm.fromRow(algo.data) };
  }
}
```

### 4.5 The missing-config concept gets an implementation, not eight branches

```ts
// src/lib/adapters/supabase/unavailable.ts
export const unconfiguredCatalog: AlgorithmCatalog = {
  listSystemSets:      () => { throw new StoreNotConfigured(); },
  loadSet:             () => { throw new StoreNotConfigured(); },
  loadPracticeContext: () => { throw new StoreNotConfigured(); },
};
export const unconfiguredIdentity: IdentityGateway = {
  currentLearner: async () => null,        // "nobody is signed in" is the honest answer
  signIn:  async () => err({ reason: "provider_unavailable" }),
  signUp:  async () => err({ reason: "provider_unavailable" }),
  signOut: async () => {},                 // idempotent, as today (signout.ts:6)
};

// src/lib/adapters/supabase/index.ts — the ONE construction point
export function catalog(req: Headers, cookies: AstroCookies): AlgorithmCatalog {
  const db = createSupabaseClient(req, cookies);          // null when secrets absent
  return db ? new SupabaseAlgorithmCatalog(db) : unconfiguredCatalog;
}
```

**Consumers stop branching on `null`.** The port is always there. The eight
divergent answers from §3.2 collapse into one `StoreNotConfigured` handled once
per layer — and the string `"Supabase not configured"` disappears from the wire
contract at `complete.ts:45`, replaced by a vendor-neutral
`{ error: "store_unavailable" }`.

The construction point keeps obeying `AGENTS.md`: `SUPABASE_URL` / `SUPABASE_KEY`
are still read only from `astro:env/server`, still only in
`src/lib/adapters/supabase/client.ts`.

---

## Step 5 — Proof of isolation, before/after, and the contract questions settled

### 5.1 What a replacement touches — the enumerated proof

Suppose Supabase is replaced (Postgres + Drizzle + Lucia; Neon + PostgREST;
Turso; anything). Files edited:

| File | Edited? | Why |
|---|---|---|
| `src/lib/adapters/supabase/*` (8 files) | **yes** — deleted, and a sibling `adapters/<new>/` written | this is the entire blast radius |
| `src/lib/domain/**` (ports, VOs, errors) | **no** | ports name MemQ concepts; `Learner.fromProviderClaims` takes `{ id, email }`, which any provider yields |
| `src/db/database.types.ts` | **yes** — regenerated or replaced | generated artefact; imported only by the adapter after Phase 7 |
| `supabase/migrations/*.sql` | **no** (schema), **port** (dialect) | the four tables, the ownership CHECK `:12-16`, the UNIQUE `:51` and the 13 RLS policies `:61-151` are Postgres, not Supabase. A Postgres-to-Postgres move is a copy. Only `auth.uid()` needs a session-variable equivalent — one predicate, 13 mechanical edits, and the port never sees it |
| `src/pages/api/auth/{signin,signup,signout}.ts` | **no** | they call `identity.signIn(...)` and switch on `SignInFailure.reason` |
| `src/pages/api/practice/complete.ts` | **no** | calls `store.*`, catches domain errors |
| `src/pages/dashboard.astro`, `sets/[id].astro`, `sets/[id]/[algoId].astro` | **no** | one `catalog.*` call each, then domain objects |
| `src/components/Topbar.astro` | **no** | renders `learner.displayName()` |
| `src/components/app/*.astro`, `PracticeSession.tsx` | **no** | already receive props; after Phase 4 they receive `Algorithm` / `MoveSequence` instead of `moves: string` |
| `src/middleware.ts` | **no** | `locals.learner = await identity.currentLearner()` |
| `src/env.d.ts` | **no** | `learner: Learner \| null` — a domain type |
| `src/lib/practice/streak.ts` | **no** | already pure (`:22-25`) |
| `src/lib/practice/completePractice.ts` | **no** | signature takes `PracticeStore`, not a client |
| `src/lib/practice/completePractice.test.ts` | **no** | fakes the port, not a builder chain |
| `src/test/integration/db.ts` | **yes** | by design — it is the integration suite's own adapter (`test-plan.md:172-176`) |
| `src/test/integration/*.int.test.ts` | **no** (after Phase 7) | they import `ServiceClient` / `AuthedClient` type aliases re-exported from `db.ts` |
| `playwright/test/**` | **no** | already black-box over HTTP |

**Two directories change. Tables, wire contracts, and UI do not.**

### 5.2 Before / after, per duplicated or leaking site

| Site | Before | After |
|---|---|---|
| `sets/[id].astro:19-23` + `[algoId].astro:36-40` | the identical set-by-id query, twice | one `loadSet` / `loadPracticeContext`; the SQL exists once |
| `[algoId].astro:23-28,36-40` | two independent reads awaited sequentially — violates `lessons.md:5-13` | `Promise.all` inside `loadPracticeContext`; the lesson is structural, not remembered |
| `dashboard.astro:15-19` | PostgREST chain in a template | `await catalog.listSystemSets()` → `AlgorithmSet[]` |
| `dashboard.astro:22`, `sets/[id].astro:26,36`, `[algoId].astro:33,45` | `PostgrestError.message` rendered to the learner | `catch (SetNotFound)` → redirect; `catch (StoreUnavailable)` → one owned, translated banner |
| `[algoId].astro:67` → `PracticeSession.tsx:216-218` | raw `moves: string` crosses to the browser and is re-tokenized there; `MoveSequence.astro:7` re-tokenizes a third time | `Algorithm.sequence` is already a validated `MoveSequence`; the island receives tokens. **The UI layer receives finished domain data, not a raw row value** |
| `signin.ts:16` / `signup.ts:16` | GoTrue's English `error.message` becomes a URL parameter and the UI's copy | `SignInFailure.reason` → the app's own Polish copy in the form component |
| `signin.ts:10-12` + 7 more sites (§3.2) | eight different answers to "no client" | `StoreNotConfigured`, raised by one `unconfigured*` implementation |
| `complete.ts:44-49` | `500 { error: "Supabase not configured" }` — vendor name on the wire | `503 { error: "store_unavailable" }` |
| `completePractice.ts:12,46` | `SupabaseClient<Database>` in a domain signature | `store: PracticeStore` |
| `completePractice.ts:52-93` | three inline query chains | three port calls; the chains live in `SupabasePracticeStore` |
| `completePractice.ts:69` | `error.code === "23503"` decides 400 vs 500 | `catch (UnknownAlgorithmReferenced)` → 400; translation table owns the SQLSTATE |
| `completePractice.ts:81-82` | `?? 0` / `?? false` inline defaults | `MasteryState.initial()` |
| `completePractice.test.ts:27-46` | hand-built fluent chain + `as unknown as` | a ~10-line in-memory `PracticeStore`; the `as unknown as` cast is deleted |
| `env.d.ts:3` | vendor `User` in the ambient global namespace | `learner: Learner \| null` |
| `Topbar.astro:2,11` | renders a Supabase `User`'s `.email` | renders `learner.displayName()` |
| `middleware.ts:10-13` | `supabase.auth.getUser()` destructured in middleware | `await identity.currentLearner()` |
| `test/integration/*.int.test.ts:2` (×3) | each imports `SupabaseClient` from the vendor | import `ServiceClient` / `AuthedClient` from `@/test/integration/db` |

### 5.3 Open questions that depend on this library's contract — settled

Both were verified against the library's own source via Context7, not from
memory.

**Q1 — What does `.single()` actually return for a row that is absent or
RLS-invisible, and is `bannerError = listError.message` a correct thing to show a
learner?**

Settled: `no`. `postgrest-js` sets `code: "PGRST116"` with HTTP 406 and
`message: "JSON object requested, multiple (or no) rows returned"`
(`PostgrestBuilder.ts`, `PostgrestError.ts`). `PostgrestError` carries exactly
`message`, `details`, `hint`, `code` — and **no** `status` field. Consequences
for MemQ:

- `sets/[id].astro:26` and `[algoId].astro:45` today render that sentence to a
  learner who opened a set that does not exist or belongs to someone else. It is
  the wrong register, the wrong language, and it describes PostgREST's content
  negotiation.
- Because RLS makes another learner's row simply *not returned*, `PGRST116` on a
  by-id read is the **only** signal for both "no such set" and "not yours".
  Collapsing them into one `SetNotFound` is required, not merely tidy — a
  distinguishable "forbidden" would leak existence and weaken
  `prd.md:111`/INV-11.
- **Where to encode it:** `translateRead` in
  `src/lib/adapters/supabase/errorTranslation.ts`, keyed on
  `ctx.kind === "by-id"`. **Not** in a page, **not** in an API route.
- Corollary: the domain error model must not carry an HTTP status inherited from
  a DB error, because the library does not supply one. Status selection stays in
  the route.

**Q2 — Is `error.message` the right discriminator for auth failures, or is there
a stable machine-readable contract?**

Settled: there is a stable one, and it is not the message. `AuthError` exposes
`code: ErrorCode | (string & {}) | undefined` plus `status: number | undefined`,
and `ErrorCode` is a documented union that includes `invalid_credentials`,
`user_not_found`, `email_not_confirmed`, `email_exists`, `user_already_exists`,
`weak_password`, `email_address_invalid`, `signup_disabled`,
`over_request_rate_limit`, `over_email_send_rate_limit`
(`auth-js/src/lib/errors.ts`, `auth-js/src/lib/error-codes.ts`). Consequences:

- Branch on `code`, never on `message` — messages are server-side copy and are
  not a contract.
- `code` can be `undefined` for pre-response failures (the docs say so
  explicitly, and that `status` is then also undefined). The `default` arm of
  `translateSignIn`/`translateSignUp` must therefore be
  `provider_unavailable`, and it must be reachable — a switch without a default
  would silently produce `undefined` on a network fault.
- **Where to encode it:** `translateSignIn` / `translateSignUp` in
  `errorTranslation.ts`. The route maps `reason` → status; the form component
  maps `reason` → Polish copy. `signin.ts:16` and `signup.ts:16` lose the
  `encodeURIComponent(error.message)` forwarding entirely.
- Deliberate decision recorded in the ACL: `invalid_credentials` and
  `user_not_found` collapse to one `reason`, so sign-in cannot be used to
  enumerate registered addresses.

---

## Step 6 — Verification and phased plan

### 6.1 Success criterion

```bash
grep -rn "@supabase/" src/ --include='*.ts' --include='*.tsx' --include='*.astro'
```

**Must return only** paths under `src/lib/adapters/supabase/` and the single file
`src/test/integration/db.ts`. And:

```bash
grep -rn "@/lib/supabase" src/            # must return nothing — the module is gone
grep -rn '"23503"\|PGRST116\|onConflict\|\.from("' src/ \
  | grep -v 'src/lib/adapters/supabase/' | grep -v 'src/test/integration/db.ts'
                                          # must return nothing
grep -rn "Supabase" src/pages src/components src/middleware.ts src/env.d.ts
                                          # must return nothing (Welcome.astro:76 is marketing copy — exempt)
```

Worth adding as a CI step next to `npm run lint` (`AGENTS.md`, CI gate), so the
seam cannot silently reopen.

### 6.2 Files that know the dependency: today vs. after

**Today — 17 sites (§ Step 1, Axis A).**

| After the refactor | Knows `@supabase/*`? |
|---|---|
| `src/lib/adapters/supabase/**` (8 files) | **yes — by design** |
| `src/test/integration/db.ts` | **yes — by design** (`test-plan.md:172-176`) |
| `src/db/database.types.ts` | generated; imported only by the adapter |
| `src/env.d.ts` | **no** |
| `src/middleware.ts` | **no** |
| `src/components/Topbar.astro` | **no** |
| `src/pages/dashboard.astro` | **no** |
| `src/pages/sets/[id].astro` | **no** |
| `src/pages/sets/[id]/[algoId].astro` | **no** |
| `src/pages/api/auth/signin.ts` | **no** |
| `src/pages/api/auth/signup.ts` | **no** |
| `src/pages/api/auth/signout.ts` | **no** |
| `src/pages/api/practice/complete.ts` | **no** |
| `src/lib/practice/completePractice.ts` | **no** |
| `src/lib/practice/completePractice.test.ts` | **no** |
| `src/test/integration/persistence.int.test.ts` | **no** |
| `src/test/integration/streak.int.test.ts` | **no** |
| `src/test/integration/smoke.int.test.ts` | **no** |

17 → 9 (8 of which are the ACL itself, plus the integration suite's own,
already-documented adapter).

### 6.3 Phases

Project convention: one change folder per phase group under
`context/changes/<change-id>/` (`/10x-new` → `/10x-plan` → `/10x-implement`),
Conventional Commits, `npm run lint` + `npm run build` green on every commit,
no fourth test runner. Phases 1–2 are pure logic → **test-first**; 3–7 are wiring
→ tests alongside.

| Phase | Scope | Runner | Commit |
|---|---|---|---|
| **1** | `src/lib/domain/` — `Learner`, `EmailAddress`, `AlgorithmSet`, `Algorithm`, `MasteryState`, `errors.ts`, `ports.ts`. No adapter, no call sites. Oracle for `fromRow`/`fromProviderClaims` is the PRD + the migration, never the mapper itself | `npm test` | `feat(domain): add identity, catalog and practice value objects with ports` |
| **2** | `src/lib/adapters/supabase/` — move `lib/supabase.ts` here as `client.ts`; write `errorTranslation.ts` (the two tables from §5.3), `rowMapping.ts`, the three adapters, `unavailable.ts`, `index.ts`. Nothing imports them yet | `npm run test:integration` (real stack, per `test-plan.md:166`) + unit tests for the pure translation functions | `feat(adapters): add Supabase anti-corruption layer` |
| **3** | Identity: `env.d.ts` → `learner: Learner \| null`; `middleware.ts` → `IdentityGateway`; `Topbar.astro` → `displayName()`. **This is the phase that closes the ambient-type hole (§3.4)** | `npm test`, `npm run test:e2e` (`playwright/test/auth.setup.ts` is the regression net) | `refactor(auth): carry a domain Learner through App.Locals` |
| **4** | Catalog: the three `.astro` pages lose `createClient` and all PostgREST chains; `[algoId].astro` gets `Promise.all` for free; the island receives a `MoveSequence` instead of `moves: string` | `npm run test:e2e` (`seed.spec.ts`, `moves-grid-rework.spec.ts`, `rotation-notation-fix.spec.ts`) | `refactor(pages): read algorithm data through the catalog port` |
| **5** | Practice: `completePractice.ts` takes `PracticeStore`; `"23503"` and the inline defaults are deleted; `completePractice.test.ts` swaps the fluent-chain stub for an in-memory port. `streak.ts` untouched | `npm test`, `npm run test:integration` (`streak.int.test.ts`, `persistence.int.test.ts` must pass unchanged — the behaviour is neutral) | `refactor(practice): invert the persistence dependency behind PracticeStore` |
| **6** | Auth wire: both routes switch on `reason`; the `encodeURIComponent(error.message)` forwarding is deleted; Polish copy lands in the form components next to `config-status.ts:15`. `complete.ts:45` becomes vendor-neutral | `npm run test:e2e` | `refactor(api): map domain auth failures instead of forwarding provider messages` |
| **7** | Cleanup + gate: delete `src/lib/supabase.ts`; re-export `ServiceClient`/`AuthedClient` from `test/integration/db.ts` and drop the three spec-level vendor imports; add the §6.1 grep to CI; record the lesson in `context/foundation/lessons.md` | `npm run lint`, `npm run build`, all three suites | `chore(ci): fail the build when @supabase leaves the adapter directory` |

### 6.4 Ordering against doc 02, and against the roadmap

Do **not** run both refactors at once. Recommended order:

1. **Phases 1–5 here.** They are behaviour-neutral: the same queries, the same
   statuses, the same wire bodies (except `complete.ts:45`), so the existing
   integration and e2e suites are a genuine regression net.
2. **Then doc 02.** Its `PracticeAttemptRepository` (`02-invariant-aggregate-refactor.md:289-296`) *is* a
   narrowed `PracticeStore`; its atomic RPC and the `attempt_id` UNIQUE +
   `is_clean`/`error_count` CHECK migration land inside
   `SupabasePracticeStore` and nowhere else. Doing 02 first means writing the
   aggregate against `SupabaseClient<Database>` and then moving it — the same
   work twice.
3. **Then Phases 6–7**, then S-03 / S-04 (`roadmap.md:35-36`). Both pending
   slices are new data access: S-04 (`custom-list-algorithm-entry`) adds writes
   to `algorithm_lists` / `algorithms` plus FR-015 duplicate detection over
   *all* stored sequences — which is a `MoveSequence` comparison, i.e. a
   `Algorithm.fromRow` consumer. Landing the ACL first means S-03 and S-04 add
   port methods instead of adding the ninth and tenth PostgREST chain to a
   template.

### 6.5 Follow-up, not in scope here

Axis B (`react-hotkeys-hook`, §Step 1) deserves its own small plan: a
`KeyBinding` domain type whose `toComboString()` is the only code that speaks the
library's `"shift+r"` notation, so `src/test/tokenGrammar.ts:14-16` derives
`PRODUCIBLE_TOKENS` from a domain table rather than from a React component's
library-shaped keys. Doc 02 already moves that file to
`src/lib/domain/notation/moveGrammar.ts` (`02-invariant-aggregate-refactor.md:391`, phase P0 `:403`); this is the natural
continuation.
