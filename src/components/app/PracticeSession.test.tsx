import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PracticeSession from "@/components/app/PracticeSession";

// Stub the completion endpoint at the network boundary so no Supabase /
// astro:env code enters the test graph. Tests that need the PRO state override
// the resolved payload.
function stubFetch(result: { consecutiveClean: number; masteryReached: boolean }) {
  const mock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(result),
    } as Response),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Start Practice" }));
}

describe("PracticeSession — modifier assembly (#3 JSX closure)", () => {
  beforeEach(() => {
    stubFetch({ consecutiveClean: 1, masteryReached: false });
  });

  it("wide modifier lowercases a grid-clicked base move (R → r)", async () => {
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="r" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "W" })); // activate wide
    await user.click(screen.getByRole("button", { name: "R" })); // emits "r"

    // Completion banner only appears if the assembled token matched expected "r".
    expect(await screen.findByText(/Clean run!/)).toBeInTheDocument();
  });

  it("double modifier appends 2 to a grid-clicked base move (R → R2)", async () => {
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="R2" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "X2" })); // activate double
    await user.click(screen.getByRole("button", { name: "R" })); // emits "R2"

    expect(await screen.findByText(/Clean run!/)).toBeInTheDocument();
  });

  it("shift yields a prime via the keyboard map (shift+r → R')", async () => {
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="R'" />);
    await start(user);

    await user.keyboard("{Shift>}r{/Shift}"); // emits "R'"

    expect(await screen.findByText(/Clean run!/)).toBeInTheDocument();
  });
});

describe("PracticeSession — end-state color + PRO gating (#3 JSX closure)", () => {
  it("clean run renders the green banner, not PRO", async () => {
    stubFetch({ consecutiveClean: 1, masteryReached: false });
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="R" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "R" })); // correct, clean

    const banner = await screen.findByText(/Clean run!/);
    expect(banner).toBeInTheDocument();
    expect(banner.className).toContain("text-green-300");
    expect(screen.queryByText(/You're PRO/)).not.toBeInTheDocument();
  });

  it("run with an error renders the amber banner (streak reset)", async () => {
    stubFetch({ consecutiveClean: 0, masteryReached: false });
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="R" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "F" })); // wrong → errorCount 1, blocks
    await user.click(screen.getByRole("button", { name: "R" })); // correct → completes

    const banner = await screen.findByText(/Completed with 1 error/);
    expect(banner).toBeInTheDocument();
    expect(banner.className).toContain("text-amber-300");
    expect(screen.queryByText(/Clean run!/)).not.toBeInTheDocument();
  });

  it("mastery gates the PRO banner over the clean banner", async () => {
    stubFetch({ consecutiveClean: 3, masteryReached: true });
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="R" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "R" })); // clean completion

    expect(await screen.findByText(/You're PRO/)).toBeInTheDocument();
    expect(screen.queryByText(/Clean run!/)).not.toBeInTheDocument();
  });
});

describe("PracticeSession — grid click routes through dispatchMove (#5 cross-input)", () => {
  it("clicking u with an active double modifier emits u2", async () => {
    stubFetch({ consecutiveClean: 1, masteryReached: false });
    const user = userEvent.setup();
    render(<PracticeSession algorithmId="algo-1" moves="u2" />);
    await start(user);

    await user.click(screen.getByRole("button", { name: "X2" })); // activate double
    await user.click(screen.getByRole("button", { name: "u" })); // grid wide cell → "u2"

    expect(await screen.findByText(/Clean run!/)).toBeInTheDocument();
  });
});
