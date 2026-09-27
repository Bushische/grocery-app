import { useState } from "react";

const buttonBaseClass =
  "min-h-10 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

interface DeleteListButtonProps {
  /** Delete is offered to the selected list's OWNER only (docs/API.md → Permissions). */
  onConfirm: () => void;
  pending: boolean;
}

/** OWNER-only delete with a two-step inline confirmation. */
export function DeleteListButton({ onConfirm, pending }: DeleteListButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`${buttonBaseClass} text-red-600 hover:bg-red-50`}
      >
        Delete list
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-gray-700">Delete this list?</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={`${buttonBaseClass} bg-red-600 text-white hover:bg-red-700`}
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className={`${buttonBaseClass} text-gray-700 hover:bg-gray-100`}
      >
        Cancel
      </button>
    </span>
  );
}
