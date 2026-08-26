import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { validateMoves } from "@/lib/notation/moveGrammar";
import { cn } from "@/lib/utils";

const NAME_MAX_LENGTH = 100;

interface Props {
  listId: string;
}

interface DuplicateMatch {
  id: string;
  name: string;
  moves: string;
  listName: string;
  isSystem: boolean;
}

interface AddResponse {
  status?: string;
  match?: DuplicateMatch;
  error?: string;
}

// The FR-005 entry surface and the FR-015 decision point in one island.
//
// Notation is validated client-side with the SAME validator the endpoint uses,
// so the message a learner sees is identical either way and an invalid sequence
// costs no request. The duplicate panel keeps the typed values intact behind it,
// so "Create separate entry" can resubmit exactly what was typed.

export default function AddAlgorithmForm({ listId }: Props) {
  const [name, setName] = useState("");
  const [moves, setMoves] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [movesError, setMovesError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus to the panel when it appears, so it is announced rather than
  // silently inserted below the form.
  useEffect(() => {
    if (duplicate) {
      panelRef.current?.focus();
    }
  }, [duplicate]);

  function validate(): boolean {
    let ok = true;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Enter an algorithm name");
      ok = false;
    } else if (trimmedName.length > NAME_MAX_LENGTH) {
      setNameError(`Name must be ${String(NAME_MAX_LENGTH)} characters or fewer`);
      ok = false;
    }

    const validation = validateMoves(moves);
    if (!validation.ok) {
      setMovesError(validation.error);
      ok = false;
    }

    return ok;
  }

  async function post(body: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/lists/${listId}/algorithms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as AddResponse;

      if (res.status === 201) {
        // Reload so the new row appears in the server-rendered list.
        window.location.reload();
        return;
      }
      if (data.status === "duplicate" && data.match) {
        setDuplicate(data.match);
        setMessage(null);
        return;
      }
      if (data.status === "already_in_list") {
        setDuplicate(null);
        setMessage("That move sequence is already in this list.");
        return;
      }
      setDuplicate(null);
      setMessage(data.error ?? "Could not add the algorithm. Try again.");
    } catch {
      setDuplicate(null);
      setMessage("Could not add the algorithm. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setDuplicate(null);
    if (!validate()) {
      return;
    }
    await post({ name: name.trim(), moves });
  }

  const inputClass = (hasError: boolean) =>
    cn(
      "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
      hasError ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
    );

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-semibold text-white">Add an algorithm</h2>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor="algo-name" className="mb-1 block text-sm text-blue-100/80">
            Algorithm name
          </label>
          <input
            id="algo-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="e.g. My T-perm"
            className={inputClass(nameError !== null)}
          />
          {nameError && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="algo-moves" className="mb-1 block text-sm text-blue-100/80">
            Move sequence
          </label>
          <input
            id="algo-moves"
            name="moves"
            type="text"
            value={moves}
            onChange={(e) => {
              setMoves(e.target.value);
              if (movesError) setMovesError(null);
            }}
            placeholder="e.g. R U R' U'"
            className={cn(inputClass(movesError !== null), "font-mono")}
          />
          {movesError && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              {movesError}
            </p>
          )}
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add algorithm"}
        </Button>
      </form>

      {message && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          {message}
        </p>
      )}

      {duplicate && (
        <div
          ref={panelRef}
          role="group"
          aria-label="Duplicate algorithm found"
          tabIndex={-1}
          className="space-y-3 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 py-3"
        >
          <p className="text-sm text-blue-100">
            <span className="font-semibold text-white">{duplicate.name}</span> already has this move sequence
            {duplicate.isSystem ? (
              <>
                {" "}
                in the pre-built <span className="font-semibold text-white">{duplicate.listName}</span> set.
              </>
            ) : (
              <>
                {" "}
                in your <span className="font-semibold text-white">{duplicate.listName}</span> list.
              </>
            )}
          </p>
          <p className="font-mono text-sm text-white/80">{duplicate.moves}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={() => {
                void post({ sourceAlgorithmId: duplicate.id });
              }}
            >
              Add this one
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                void post({ name: name.trim(), moves, createAnyway: true });
              }}
            >
              Create separate entry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
