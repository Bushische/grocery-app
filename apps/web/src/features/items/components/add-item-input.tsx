import type { SuggestGroup } from "@grocery/shared";
import { useState } from "react";
import { useSmartAdd } from "../hooks/use-smart-add";
import { useSuggest } from "../hooks/use-suggestions";

const GENERIC_ADD_ERROR = "Could not add the item. Please try again.";

export interface AddItemInputProps {
  listId: string;
}

/**
 * The bottom input box (docs/TASKS.md → T17): free text → suggestions debounced
 * 200 ms and grouped by category with color bars; Enter or tapping a suggestion
 * runs smart-add — matching an existing item re-activates it when bought,
 * unknown text creates an item in "Other" (docs/API.md → Items).
 *
 * No virtualization: the suggest endpoint caps results at 20 (docs/API.md),
 * far below the > 200-results threshold at which a virtual list would pay off.
 */
export function AddItemInput({ listId }: AddItemInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const suggestions = useSuggest(listId, text);
  const smartAdd = useSmartAdd(listId);

  const trimmed = text.trim();

  /** Enter (form submit) or a tapped suggestion → smart-add with the given text. */
  function add(value: string) {
    const clean = value.trim();
    if (!clean || smartAdd.isPending) return;
    setError(null);
    smartAdd.mutate(clean, {
      onSuccess: () => {
        setText("");
        setError(null);
      },
      onError: () => setError(GENERIC_ADD_ERROR),
    });
  }

  const groups = trimmed && suggestions.data ? suggestions.data.groups : [];
  const visible = groups.filter((group) => group.items.length > 0);

  return (
    <div data-testid="add-item-box">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add(text);
        }}
        className="flex items-center gap-2"
      >
        <input
          aria-label="Add item"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add an item…"
          autoComplete="off"
          className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-base outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!trimmed || smartAdd.isPending}
          className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {smartAdd.isPending ? "Adding…" : "Add"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ul aria-label="Suggestions" className="mt-1">
          {visible.map((group) => (
            <SuggestionGroup key={group.category.id} group={group} onSelect={add} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SuggestionGroup({
  group,
  onSelect,
}: {
  group: SuggestGroup;
  onSelect: (title: string) => void;
}) {
  return (
    <li>
      <div className="mt-2 flex items-center gap-1.5 px-1 text-xs font-medium text-gray-500">
        <span
          aria-hidden="true"
          className="h-3 w-1.5 rounded"
          style={{ backgroundColor: group.category.color }}
        />
        {group.category.title}
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-testid={`suggestion-${item.id}`}
              onClick={() => onSelect(item.title)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-gray-100"
            >
              <span
                aria-hidden="true"
                className="h-6 w-1.5 shrink-0 rounded"
                style={{ backgroundColor: group.category.color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{item.title}</span>
              {item.qtyText ? (
                <span className="shrink-0 text-xs text-gray-500">{item.qtyText}</span>
              ) : null}
              {item.status === "BOUGHT" ? (
                <span className="shrink-0 text-xs text-gray-400">bought</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
