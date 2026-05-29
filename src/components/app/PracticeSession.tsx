import { useEffect, useReducer } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// --- Key → move lookup table ---------------------------------------------
// Base moves, shift-prime variants, and two modifier sentinels (w, 2).
const KEY_TO_MOVE: Record<string, string> = {
  r: "R",
  "shift+r": "R'",
  u: "U",
  "shift+u": "U'",
  f: "F",
  "shift+f": "F'",
  l: "L",
  "shift+l": "L'",
  b: "B",
  "shift+b": "B'",
  d: "D",
  "shift+d": "D'",
  x: "x",
  "shift+x": "x'",
  y: "y",
  "shift+y": "y'",
  z: "z",
  "shift+z": "z'",
  m: "M",
  "shift+m": "M'",
  e: "E",
  "shift+e": "E'",
  s: "S",
  "shift+s": "S'",
  w: "__wide_modifier__", // sentinel — toggles wideModifier
  2: "__double_modifier__", // sentinel — toggles doubleModifier
};

// --- Move-grid layouts (col/row are 0-indexed) ---------------------------
interface GridCell {
  move: string;
  col: number;
  row: number;
}

// Side layers: face turns + wide moves, keyboard-cross layout (7 cols).
const SIDE_GRID: GridCell[] = [
  { move: "U", col: 3, row: 0 },
  { move: "U'", col: 4, row: 0 },
  { move: "u", col: 3, row: 1 },
  { move: "u'", col: 4, row: 1 },
  { move: "L'", col: 0, row: 2 },
  { move: "l'", col: 1, row: 2 },
  { move: "F'", col: 2, row: 2 },
  { move: "F", col: 4, row: 2 },
  { move: "r", col: 5, row: 2 },
  { move: "R", col: 6, row: 2 },
  { move: "f'", col: 2, row: 3 },
  { move: "f", col: 3, row: 3 },
  { move: "b", col: 2, row: 4 },
  { move: "b'", col: 3, row: 4 },
  { move: "L", col: 0, row: 5 },
  { move: "l", col: 1, row: 5 },
  { move: "B", col: 2, row: 5 },
  { move: "B'", col: 4, row: 5 },
  { move: "r'", col: 5, row: 5 },
  { move: "R'", col: 6, row: 5 },
  { move: "d'", col: 3, row: 6 },
  { move: "d", col: 4, row: 6 },
  { move: "D'", col: 3, row: 7 },
  { move: "D", col: 4, row: 7 },
];

// Central layers (M, E, S) — cross layout (4 cols).
const CENTRAL_GRID: GridCell[] = [
  { move: "M'", col: 1, row: 0 },
  { move: "E'", col: 0, row: 1 },
  { move: "S'", col: 1, row: 1 },
  { move: "S", col: 2, row: 1 },
  { move: "E", col: 3, row: 1 },
  { move: "M", col: 1, row: 2 },
];

// Cube rotations (x, y, z) — cross layout (4 cols).
const ROTATION_GRID: GridCell[] = [
  { move: "x", col: 1, row: 0 },
  { move: "y", col: 0, row: 1 },
  { move: "z'", col: 1, row: 1 },
  { move: "z", col: 2, row: 1 },
  { move: "y'", col: 3, row: 1 },
  { move: "x'", col: 1, row: 2 },
];

// --- State ---------------------------------------------------------------
type Phase = "idle" | "active" | "submitting" | "complete" | "error";
type SlotResult = "pending" | "correct" | "wrong";

interface SessionResult {
  consecutiveClean: number;
  masteryReached: boolean;
}

interface State {
  phase: Phase;
  slotResults: SlotResult[];
  currentIndex: number;
  errorCount: number;
  result: SessionResult | null;
  wideModifier: boolean;
  doubleModifier: boolean;
  submitError: string | null;
}

type Action =
  | { type: "START" }
  | { type: "INPUT_MOVE"; move: string }
  | { type: "TOGGLE_WIDE_MODIFIER" }
  | { type: "TOGGLE_DOUBLE_MODIFIER" }
  | { type: "RETRY" }
  | { type: "STOP" }
  | { type: "SUBMIT_RESULT"; result: SessionResult }
  | { type: "SUBMIT_ERROR"; message: string };

function reducer(state: State, action: Action, tokens: string[]): State {
  switch (action.type) {
    case "START":
      return {
        ...state,
        phase: "active",
        slotResults: tokens.map(() => "pending"),
        currentIndex: 0,
        errorCount: 0,
        result: null,
        wideModifier: false,
        doubleModifier: false,
        submitError: null,
      };

    case "INPUT_MOVE": {
      if (state.phase !== "active") return state;
      const expected = tokens[state.currentIndex];
      const correct = action.move === expected;
      const slotResults = [...state.slotResults];

      if (correct) {
        slotResults[state.currentIndex] = "correct";
        const nextIndex = state.currentIndex + 1;
        const done = nextIndex >= tokens.length;
        return {
          ...state,
          slotResults,
          currentIndex: nextIndex,
          phase: done ? "submitting" : "active",
          wideModifier: false,
          doubleModifier: false,
        };
      }

      // Wrong move: mark slot red and count every wrong attempt.
      slotResults[state.currentIndex] = "wrong";
      return {
        ...state,
        slotResults,
        errorCount: state.errorCount + 1,
        wideModifier: false,
        doubleModifier: false,
      };
    }

    case "TOGGLE_WIDE_MODIFIER":
      return { ...state, wideModifier: !state.wideModifier };

    case "TOGGLE_DOUBLE_MODIFIER":
      return { ...state, doubleModifier: !state.doubleModifier };

    case "RETRY":
      return { ...state, phase: "submitting", submitError: null };

    case "STOP":
      return {
        ...state,
        phase: "idle",
        slotResults: tokens.map(() => "pending"),
        currentIndex: 0,
        errorCount: 0,
        result: null,
        wideModifier: false,
        doubleModifier: false,
        submitError: null,
      };

    case "SUBMIT_RESULT":
      return { ...state, phase: "complete", result: action.result };

    case "SUBMIT_ERROR":
      return { ...state, phase: "error", submitError: action.message };

    default:
      return state;
  }
}

// --- Props ---------------------------------------------------------------
interface PracticeSessionProps {
  algorithmId: string;
  moves: string; // raw moves string from DB, e.g. "R U R' U'"
}

function parseMoves(moves: string): string[] {
  return moves.replace(/[()]/g, "").split(" ").filter(Boolean);
}

// --- Move grid -----------------------------------------------------------
function MoveGrid({ cells, columns, onMove }: { cells: GridCell[]; columns: number; onMove: (m: string) => void }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(2.5rem, 1fr))` }}>
      {cells.map((cell) => (
        <button
          key={`${cell.move}-${String(cell.col)}-${String(cell.row)}`}
          type="button"
          onClick={() => {
            onMove(cell.move);
          }}
          style={{ gridColumnStart: cell.col + 1, gridRowStart: cell.row + 1 }}
          className="rounded border border-white/20 bg-white/10 px-2 py-1 font-mono text-sm text-white transition-colors hover:bg-white/20"
        >
          {cell.move}
        </button>
      ))}
    </div>
  );
}

export default function PracticeSession({ algorithmId, moves }: PracticeSessionProps) {
  const tokens = parseMoves(moves);

  const [state, dispatch] = useReducer((s: State, a: Action) => reducer(s, a, tokens), {
    phase: "idle",
    slotResults: tokens.map(() => "pending"),
    currentIndex: 0,
    errorCount: 0,
    result: null,
    wideModifier: false,
    doubleModifier: false,
    submitError: null,
  });

  const { phase, slotResults, currentIndex, errorCount, result, wideModifier, doubleModifier, submitError } = state;

  // Assemble a move token from a base token + active modifiers, then dispatch.
  // Used by both the keyboard handler and the on-screen move buttons.
  function dispatchMove(base: string) {
    let move = base;
    if (wideModifier) move = move.toLowerCase(); // R → r, R' → r'
    if (doubleModifier) move = move + "2";
    dispatch({ type: "INPUT_MOVE", move });
  }

  useHotkeys(
    Object.keys(KEY_TO_MOVE),
    (_, handler) => {
      const keys = handler.keys ?? [];
      const mods = handler.shift ? ["shift"] : [];
      const combo = [...mods, ...keys].join("+");
      const mapped = KEY_TO_MOVE[combo];
      if (!mapped) return;
      if (mapped === "__wide_modifier__") {
        dispatch({ type: "TOGGLE_WIDE_MODIFIER" });
      } else if (mapped === "__double_modifier__") {
        dispatch({ type: "TOGGLE_DOUBLE_MODIFIER" });
      } else {
        dispatchMove(mapped);
      }
    },
    { enabled: phase === "active", preventDefault: true },
  );

  // Persist results when entering the submitting phase (also on retry).
  useEffect(() => {
    if (phase !== "submitting") return;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/practice/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ algorithmId, isClean: errorCount === 0, errorCount }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Request failed (${String(res.status)})`);
        }
        const data = (await res.json()) as SessionResult;
        dispatch({ type: "SUBMIT_RESULT", result: data });
      } catch (err) {
        if (controller.signal.aborted) return;
        dispatch({ type: "SUBMIT_ERROR", message: err instanceof Error ? err.message : "Failed to save session" });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [phase, algorithmId, errorCount]);

  const isPro = result !== null && (result.masteryReached || result.consecutiveClean >= 3);

  return (
    <div className="space-y-6">
      {/* Idle: move overview + start */}
      {phase === "idle" && (
        <>
          <div className="flex flex-wrap gap-2">
            {tokens.map((token, i) => (
              <span
                key={`${token}-${String(i)}`}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 font-mono text-sm text-white"
              >
                {token}
              </span>
            ))}
          </div>
          <Button
            onClick={() => {
              dispatch({ type: "START" });
            }}
          >
            Start Practice
          </Button>
        </>
      )}

      {/* Result / PRO banner */}
      {phase === "complete" && result !== null && (
        <div className="space-y-4">
          {isPro ? (
            <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/10 px-4 py-3 text-center text-lg font-bold text-yellow-300">
              You&apos;re PRO! 🏆
            </div>
          ) : (
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                errorCount === 0
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300",
              )}
            >
              {errorCount === 0
                ? `Clean run! Consecutive clean: ${String(result.consecutiveClean)}.`
                : `Completed with ${String(errorCount)} error${errorCount === 1 ? "" : "s"}. Streak reset.`}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {phase === "error" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {submitError ?? "Failed to save session."}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              dispatch({ type: "RETRY" });
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Slot grid — shown in active / submitting / complete / error */}
      {phase !== "idle" && (
        <div className="flex flex-wrap gap-2">
          {slotResults.map((res, i) => (
            <div
              key={i}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded font-mono text-sm text-white transition-colors",
                res === "pending" && "bg-gray-600",
                res === "correct" && "bg-green-500",
                res === "wrong" && "bg-red-500",
                phase === "active" && i === currentIndex && "ring-2 ring-blue-400",
              )}
            >
              {res === "correct" ? tokens[i] : ""}
            </div>
          ))}
        </div>
      )}

      {/* Full moves grid + modifiers — active phase only */}
      {phase === "active" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                dispatch({ type: "STOP" });
              }}
            >
              Stop
            </Button>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "TOGGLE_WIDE_MODIFIER" });
              }}
              className={cn(
                "rounded border px-3 py-1 font-mono text-sm transition-colors",
                wideModifier
                  ? "border-blue-400 bg-blue-500 text-white"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/20",
              )}
            >
              W
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "TOGGLE_DOUBLE_MODIFIER" });
              }}
              className={cn(
                "rounded border px-3 py-1 font-mono text-sm transition-colors",
                doubleModifier
                  ? "border-blue-400 bg-blue-500 text-white"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/20",
              )}
            >
              X2
            </button>
          </div>

          <div className="flex flex-wrap gap-6">
            <MoveGrid cells={SIDE_GRID} columns={7} onMove={dispatchMove} />
            <MoveGrid cells={CENTRAL_GRID} columns={4} onMove={dispatchMove} />
            <MoveGrid cells={ROTATION_GRID} columns={4} onMove={dispatchMove} />
          </div>
        </div>
      )}

      {/* Try Again — restart a fresh active session (skip overview) */}
      {phase === "complete" && (
        <Button
          variant="outline"
          onClick={() => {
            dispatch({ type: "START" });
          }}
        >
          Try Again
        </Button>
      )}
    </div>
  );
}
