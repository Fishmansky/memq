import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** DELETE target, e.g. `/api/lists/:listId` or `/api/algorithms/:algoId`. */
  endpoint: string;
  /** Accessible name of the trigger, e.g. "Delete list". */
  label: string;
  /** Sentence naming what will be lost. Visible text, not an aria-label. */
  confirmPrompt: string;
  /** Where to go on success. Omitted → reload the current page. */
  redirectTo?: string;
}

// One island for both delete surfaces (a list, an algorithm).
//
// The confirm step is an inline confirm/cancel pair rather than a native
// confirm() dialog: styled, announceable, and reachable with role-based
// locators. Deletes here are hard and cascade into practice history, so the
// prompt names what goes with it — this is the only safeguard, there is no undo.
//
// Submission is fetch + navigate (the CreateListForm idiom): these are
// server-rendered pages, so a navigation or reload is how the new state appears.

export default function ConfirmDelete({ endpoint, label, confirmPrompt, redirectTo }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const promptRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the prompt when it appears, so it is announced rather than
  // silently inserted next to the trigger (the AddAlgorithmForm panel idiom).
  useEffect(() => {
    if (confirming) {
      promptRef.current?.focus();
    }
  }, [confirming]);

  async function handleConfirm() {
    setDeleting(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });

      if (res.ok) {
        if (redirectTo) {
          window.location.href = redirectTo;
        } else {
          window.location.reload();
        }
        return;
      }

      // The endpoint's message is already a fixed, generic string — no DB
      // detail reaches here to be rendered.
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not delete. Try again.");
      setConfirming(false);
    } catch {
      setError("Could not delete. Try again.");
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          {label}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
      <p ref={promptRef} tabIndex={-1} className="text-sm text-red-100 outline-none">
        {confirmPrompt}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" onClick={handleConfirm} disabled={deleting}>
          {deleting ? "Deleting..." : "Yes, delete"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setConfirming(false);
          }}
          disabled={deleting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
