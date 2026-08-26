// custom-list-algorithm-entry.spec.ts
//
// Risk: a learner's own algorithm list is unreachable in the browser — the
//   write path exists server-side (POST /api/lists, POST
//   /api/lists/:id/algorithms) but the rendered app never surfaces it: the
//   dashboard filters custom lists out, the entry form does not render, or the
//   FR-015 duplicate decision point never appears. This is the test-plan risk
//   #2 lens turned inward (list scoping: pre-built PLUS the caller's own, and
//   nothing else), plus the PRD FR-004/FR-005/FR-015 flow that only exists in
//   the rendered UI.
// Protection proof: each scenario drives the flow the way a learner does —
//   create a list from the dashboard, see it come back on the dashboard, type a
//   sequence, and see what the app does with it. Reverting the dashboard's
//   `is_system` filter change (src/pages/dashboard.astro) makes the created list
//   invisible and scenario 1 goes red; that break-check is the phase's manual
//   verification step.
// Seed/levers: playwright/test/seed.spec.ts + playwright/test/E2E_RULES.md.
// Boundaries: auth, routing, API, RLS and DB all REAL — the duplicate match is
//   resolved by the `moves_normalized` generated column against the seeded
//   pre-built corpus, which is exactly the integration the risk lives in.
//   Nothing is mocked.
// Side effect + teardown: writes real `algorithm_lists` / `algorithms` rows for
//   the E2E user in the remote Supabase project the preview server serves. Every
//   list name carries a `Date.now()` suffix, and afterEach deletes the lists this
//   test created (by name, via the user's own session — `al_delete` / `alg_delete`
//   cover it; see playwright/test/support/e2eEnv.ts). Leftovers from a killed run
//   are visible as `algorithm_lists` rows named `e2e-cle-*`.
import { test, expect, type Page } from "@playwright/test";
import { signedInUserClient, deleteOwnLists } from "./support/e2eEnv";
import { awaitIslandsHydrated } from "./support/islands";

// Seeded pre-built row used for the duplicate scenario. Its stored sequence is
// PARENTHESISED, and the typed form below is not: a match therefore proves the
// normalized comparison (parens as separators), not string equality.
// Verified unique across the remote corpus' 127 rows — see supabase/algos_seed.sql.
const SEEDED_ALGO_NAME = "Ua-perm";
const SEEDED_SET_NAME = "PLL (Permutation of Last Layer) — full";
const SEEDED_MOVES_STORED = "R2 U' (R' U' R) U R U (R U' R)";
const SEEDED_MOVES_TYPED = "R2 U' R' U' R U R U R U' R";

// `R2'` is unreachable through the practice grid (the double modifier is always
// applied last), so the validator must reject it — see src/lib/notation/moveGrammar.ts.
const INVALID_MOVES = "R2'";

const MOVE_ALPHABET = ["R", "U", "F", "D"] as const;

// A sequence unique to this run. A fixed sequence would collide with a leftover
// row from an earlier run — the learner's own list is inside `alg_select`'s
// scope, so the second run would get the duplicate panel instead of a new row.
function uniqueSequence(): string {
  let remaining = Date.now();
  const tokens: string[] = [];
  while (remaining > 0) {
    tokens.push(MOVE_ALPHABET[remaining % MOVE_ALPHABET.length]);
    remaining = Math.floor(remaining / MOVE_ALPHABET.length);
  }
  return tokens.join(" ");
}

// Lists this test created, for afterEach. Reset per test; a Playwright worker
// runs one test at a time, so no cross-test interference.
let createdLists: string[] = [];

function listName(scenario: string): string {
  const name = `e2e-cle-${String(Date.now())}-${scenario}`;
  createdLists.push(name);
  return name;
}

// Fill the fields of a hydrated island form, then confirm each value landed.
async function fillIslandForm(page: Page, values: Record<string, string>): Promise<void> {
  await awaitIslandsHydrated(page);
  for (const [label, value] of Object.entries(values)) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }
}

// Create a list through the dashboard form and land on its set page.
async function createListViaDashboard(page: Page, name: string): Promise<void> {
  await page.goto("/dashboard");
  await fillIslandForm(page, { "New list name": name });
  await page.getByRole("button", { name: "Create list" }).click();
  // CreateListForm navigates to /sets/<new id> on 201 — wait for the URL, not a timeout.
  await page.waitForURL(/\/sets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

// Submit the add-algorithm form on the current set page.
async function submitAlgorithm(page: Page, name: string, moves: string): Promise<void> {
  await fillIslandForm(page, { "Algorithm name": name, "Move sequence": moves });
  await page.getByRole("button", { name: "Add algorithm" }).click();
}

test.afterEach(async () => {
  const names = createdLists;
  createdLists = [];
  const client = await signedInUserClient();
  await deleteOwnLists(client, names);
});

test("a learner's own list is visible on the dashboard and accepts a typed algorithm", async ({ page }) => {
  const name = listName("dashboard");
  const algoName = `My alg ${String(Date.now())}`;
  const moves = uniqueSequence();

  await createListViaDashboard(page, name);

  // Back on the dashboard, the learner's own list must come back. This is the
  // assertion the `is_system` filter change unlocks: with the old filter the
  // link is absent.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name })).toBeVisible();

  // Into the list, and add an algorithm by name + sequence.
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await submitAlgorithm(page, algoName, moves);

  // AddAlgorithmForm reloads on 201, so the row is server-rendered — the write
  // reached the DB, not just component state.
  await expect(page.getByRole("link", { name: algoName })).toBeVisible();
});

test("a sequence matching a pre-built algorithm offers that entry instead of a duplicate", async ({ page }) => {
  const name = listName("duplicate");

  await createListViaDashboard(page, name);
  await submitAlgorithm(page, "Should not be created", SEEDED_MOVES_TYPED);

  // FR-015: the app names the algorithm the learner can already see, and says
  // which pre-built set it lives in.
  const panel = page.getByRole("group", { name: "Duplicate algorithm found" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(SEEDED_ALGO_NAME, { exact: true })).toBeVisible();
  await expect(panel.getByText(SEEDED_SET_NAME, { exact: true })).toBeVisible();
  // The stored sequence is parenthesised while the typed one is not — the match
  // came from the normalized comparison.
  await expect(panel.getByText(SEEDED_MOVES_STORED, { exact: true })).toBeVisible();

  // Choosing the existing entry copies it into the learner's list.
  await panel.getByRole("button", { name: "Add this one" }).click();
  await expect(page.getByRole("link", { name: SEEDED_ALGO_NAME })).toBeVisible();
  // The typed-name row was never created.
  await expect(page.getByRole("link", { name: "Should not be created" })).toBeHidden();
});

test("an out-of-grammar move token is rejected in the form without reaching the server", async ({ page }) => {
  const name = listName("invalid");

  await createListViaDashboard(page, name);

  // The client-side validator shares the endpoint's grammar module, so an
  // invalid sequence must cost no request at all.
  const addRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/algorithms")) {
      addRequests.push(request.url());
    }
  });

  await submitAlgorithm(page, "Bad notation", INVALID_MOVES);

  await expect(page.getByRole("alert").filter({ hasText: INVALID_MOVES })).toBeVisible();
  expect(addRequests).toEqual([]);
  await expect(page.getByRole("link", { name: "Bad notation" })).toBeHidden();
});
