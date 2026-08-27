import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { validateMoves } from "@/lib/notation/moveGrammar";
import { cn } from "@/lib/utils";

const NAME_MAX_LENGTH = 100;

interface Props {
  algorithmId: string;
  name: string;
  moves: string;
}

interface DuplicateMatch {
  id: string;
  name: string;
  moves: string;
  listName: string;
  isSystem: boolean;
}

interface UpdateResponse {
  status?: string;
  match?: DuplicateMatch;
  error?: string;
}

// The edit counterpart of AddAlgorithmForm, on the algorithm's own page.
//
// Notation is validated client-side with the SAME validator the endpoint uses,
// so the message is identical either way and an invalid sequence costs no
// request. The duplicate panel is the add form's, so an edit that collides
// behaves exactly like an add that collides.
//
// Mounted behind a disclosure: practising is what this page is for, and the
// edit surface must not displace it.

export default function EditAlgorithmForm({ algorithmId, name: initialName, moves: initialMoves }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [moves, setMoves] = useState(initialMoves);
  const [nameError, setNameError] = useState<string | null>(null);
  const [movesError, setMovesError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // `blocked` distinguishes the two collision kinds: a match ELSEWHERE can be
  // overridden with "Save anyway", a match in THIS list cannot — one row is one
  // list membership, so there is nothing to override.
  const [duplicate, setDuplicate] = useState<{ match: DuplicateMatch; blocked: boolean } | null>(null);
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

  async function patch(body: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/algorithms/${algorithmId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as UpdateResponse;

      if (data.status === "updated") {
        // Reload so the heading, the tab title, and the practice session all
        // pick up the new values from the server.
        window.location.reload();
        return;
      }
      if (data.status === "duplicate" && data.match) {
        setDuplicate({ match: data.match, blocked: false });
        setMessage(null);
        return;
      }
      if (data.status === "already_in_list" && data.match) {
        setDuplicate({ match: data.match, blocked: true });
        setMessage(null);
        return;
      }
      setDuplicate(null);
      setMessage(data.error ?? "Could not save the changes. Try again.");
    } catch {
      setDuplicate(null);
      setMessage("Could not save the changes. Try again.");
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
    await patch({ name: name.trim(), moves });
  }

  const inputClass = (hasError: boolean) =>
    cn(
      "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
      hasError ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
    );

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit algorithm
      </Button>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-semibold text-white">Edit algorithm</h2>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor="edit-algo-name" className="mb-1 block text-sm text-blue-100/80">
            Algorithm name
          </label>
          <input
            id="edit-algo-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            className={inputClass(nameError !== null)}
          />
          {nameError && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="edit-algo-moves" className="mb-1 block text-sm text-blue-100/80">
            Move sequence
          </label>
          <input
            id="edit-algo-moves"
            name="moves"
            type="text"
            value={moves}
            onChange={(e) => {
              setMoves(e.target.value);
              if (movesError) setMovesError(null);
            }}
            className={cn(inputClass(movesError !== null), "font-mono")}
          />
          {movesError && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              {movesError}
            </p>
          )}
          {/* Stated up front rather than behind a second confirm dialog: the
              reset is a consequence of the edit, not a separate decision. */}
          <p className="mt-1 text-xs text-amber-300/80">
            Changing the move sequence restarts this algorithm&apos;s practice streak from zero. Editing only the name
            leaves it alone.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => {
              // Discard: restore the server's values, drop every message.
              setName(initialName);
              setMoves(initialMoves);
              setNameError(null);
              setMovesError(null);
              setMessage(null);
              setDuplicate(null);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
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
            <span className="font-semibold text-white">{duplicate.match.name}</span> already has this move sequence
            {duplicate.blocked ? (
              <> in this list. Two entries in one list cannot share a sequence.</>
            ) : duplicate.match.isSystem ? (
              <>
                {" "}
                in the pre-built <span className="font-semibold text-white">{duplicate.match.listName}</span> set.
              </>
            ) : (
              <>
                {" "}
                in your <span className="font-semibold text-white">{duplicate.match.listName}</span> list.
              </>
            )}
          </p>
          <p className="font-mono text-sm text-white/80">{duplicate.match.moves}</p>
          <div className="flex flex-wrap gap-2">
            {/* Offered only for a match elsewhere. The typed values stay intact
                behind the panel, so this resubmits exactly what was entered. */}
            {!duplicate.blocked && (
              <Button
                type="button"
                disabled={submitting}
                onClick={() => {
                  void patch({ name: name.trim(), moves, createAnyway: true });
                }}
              >
                Save anyway
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setDuplicate(null);
              }}
            >
              Keep editing
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
