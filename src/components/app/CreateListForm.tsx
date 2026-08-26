import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAME_MAX_LENGTH = 100;

// Create-list island for the dashboard. Client-side validation mirrors
// SignUpForm: a synchronous check, the message in local state, cleared on the
// next keystroke. Submission is fetch (the PracticeSession idiom) rather than a
// form action, so the page does not transition on failure.

export default function CreateListForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a list name");
      return false;
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      setError(`List name must be ${String(NAME_MAX_LENGTH)} characters or fewer`);
      return false;
    }
    return true;
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json()) as { id?: string; error?: string };

      if (res.status === 201 && data.id) {
        // Server-rendered page, so navigate rather than patching state in.
        window.location.href = `/sets/${data.id}`;
        return;
      }
      setError(data.error ?? "Could not create the list. Try again.");
    } catch {
      setError("Could not create the list. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-sm space-y-3">
      <div>
        <label htmlFor="new-list-name" className="mb-1 block text-sm text-blue-100/80">
          New list name
        </label>
        <input
          id="new-list-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. Sunday drills"
          className={cn(
            "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
            error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
          )}
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating list..." : "Create list"}
      </Button>
    </form>
  );
}
