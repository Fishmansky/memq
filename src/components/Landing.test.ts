import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the landing page at `/`. Nothing else automated touches
// it — no other unit test, and no Playwright spec calls goto("/") — so without
// this a later edit could reintroduce starter boilerplate or drop one side of
// the auth-aware CTA branch and every check would still pass.
//
// KNOWN LIMITATION: these are string assertions on source text, not on rendered
// output. The test proves both CTA branches exist in the source; it does NOT
// prove each renders under the right `Astro.locals.user` value — a branch wired
// to an inverted condition would still pass. A behavioral guard would need the
// Astro Container API with `renderToString(Landing, { locals })`, which requires
// `environment: 'node'` (Astro 6 forbids rendering `.astro` in a Vitest client
// environment) plus the Astro Vite plugin that vitest.config.ts deliberately
// excludes. That branch-correctness check is covered by manual verification.

// Resolved from import.meta.url, not process.cwd(), so the test does not depend
// on where Vitest is invoked from.
const read = (relativeToSrc: string): string =>
  readFileSync(fileURLToPath(new URL(relativeToSrc, import.meta.url)), "utf8");

const SOURCES = {
  "Landing.astro": read("./Landing.astro"),
  "index.astro": read("../pages/index.astro"),
  "Layout.astro": read("../layouts/Layout.astro"),
} as const;

describe("landing page source", () => {
  describe.each(Object.entries(SOURCES))("%s", (_name, source) => {
    it("carries no starter branding", () => {
      expect(source).not.toMatch(/astro starter/i);
      expect(source).not.toMatch(/10x-astro/);
    });
  });

  it("Landing.astro keeps the anonymous CTA branch", () => {
    expect(SOURCES["Landing.astro"]).toContain("/auth/signin");
    expect(SOURCES["Landing.astro"]).toContain("/auth/signup");
  });

  it("Landing.astro keeps the signed-in CTA branch", () => {
    expect(SOURCES["Landing.astro"]).toContain("/dashboard");
  });

  it("index.astro passes an explicit title to Layout", () => {
    expect(SOURCES["index.astro"]).toMatch(/<Layout\s+title=/);
  });
});
