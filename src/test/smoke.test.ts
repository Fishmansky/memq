// Smoke test: proves the Vitest harness runs and globals are available
// before any real assertion depends on it. Removable once Phase 3 lands.
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
