// Shared Playwright support: the Astro island hydration barrier. NOT a spec
// (no `.spec.ts` suffix), so Playwright's default testMatch never collects it.
import type { Page } from "@playwright/test";

/**
 * Wait until every `client:*` island on the page has hydrated.
 *
 * Load-bearing, not defensive. A `fill` that lands before hydration writes the
 * DOM value but never reaches React state — and the value STICKS (React 19
 * leaves an existing DOM value alone when it hydrates a controlled input), so
 * `toHaveValue` passes while the component's state is still `""`. The submit
 * then fails validation with an empty-field error. Asserting the value cannot
 * detect this race; only Astro's own hydration signal can.
 *
 * Contract (astro/dist/runtime/server/astro-island.prebuilt.js): the custom
 * element removes its `ssr` attribute after its hydrator resolves. Zero
 * `astro-island[ssr]` nodes therefore means every island on the page is live.
 * This is a readiness barrier only — elements are still located by
 * role/label/text everywhere else.
 */
export async function awaitIslandsHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
}
