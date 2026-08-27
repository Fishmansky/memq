import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAME_MAX_LENGTH = 100;

interface Props {
  listId: string;
  currentName: string;
}

// Rename-list island for the list page. A direct sibling of CreateListForm:
// same synchronous validation, same two messages, same fetch-then-navigate
// shape. Reloads rather than patching state in, because the heading, the browser
// tab title, and the delete prompt all read the name server-side.

export default function RenameListForm({ listId, currentName }: Props) {
  const [name, setName] = useState(currentName);
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
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json()) as { id?: string; error?: string };

      if (res.status === 200) {
        window.location.reload();
        return;
      }
      setError(data.error ?? "Could not rename the list. Try again.");
    } catch {
      setError("Could not rename the list. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const unchanged = name.trim() === currentName.trim();

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-sm space-y-3">
      <div>
        <label htmlFor="rename-list-name" className="mb-1 block text-sm text-blue-100/80">
          List name
        </label>
        <input
          id="rename-list-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
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
      <Button type="submit" disabled={submitting || unchanged}>
        {submitting ? "Renaming..." : "Rename list"}
      </Button>
    </form>
  );
}
