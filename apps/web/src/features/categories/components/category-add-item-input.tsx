import { useState } from "react";
import {
  MAX_VISIBLE_SUGGESTIONS,
  capSuggestionGroups,
} from "../../items/components/add-item-input";
import { useSuggest } from "../../items/hooks/use-suggestions";
import {
  useCreateCategoryItem,
  useReactivateCategoryItem,
} from "../hooks/use-category-item-actions";

const GENERIC_ADD_ERROR = "Could not add the item. Please try again.";

export interface CategoryAddItemInputProps {
  listId: string;
  categoryId: string;
}

/**
 * The category view's bottom input bar (docs/TASKS.md → T43): the T29 popover
 * pattern (≤ 3 suggestions above the input + a Create row) scoped to one
 * category. Suggestions come from the same list-wide GET /items/suggest, but
 * only this category's group is shown, so:
 *
 * - a TO_BUY suggestion is a no-op (already listed) that just closes the
 *   popover;
 * - a BOUGHT suggestion is re-activated via POST /items/:id/move
 *   { status: "to_buy" } — it stays in this category;
 * - the Create row (and Enter) run plain POST /lists/:id/items with
 *   `categoryId` fixed to this category — the item lands here regardless of
 *   the main screen's "Other" fallback (smart-add is not used at all).
 *
 * Open/close behavior mirrors AddItemInput: opens on typing, closes on Escape,
 * on blur leaving the box, and after a successful action; a failed action
 * keeps the popover open so it can be retried. Selection rows preventDefault
 * on pointerdown so taps stay reliable on browsers that do not focus buttons.
 */
export function CategoryAddItemInput({ listId, categoryId }: CategoryAddItemInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const suggestions = useSuggest(listId, text);
  const createItem = useCreateCategoryItem(listId, categoryId);
  const reactivate = useReactivateCategoryItem(listId, categoryId);

  const trimmed = text.trim();

  /** Create row / Enter (form submit) → plain create in this category. */
  function create(value: string) {
    const clean = value.trim();
    if (!clean || createItem.isPending) return;
    setError(null);
    createItem.mutate(clean, {
      onSuccess: () => {
        setText("");
        setError(null);
      },
      onError: () => setError(GENERIC_ADD_ERROR),
    });
  }

  /**
   * A tapped suggestion: BOUGHT rows are re-activated in place; TO_BUY rows
   * are already listed — closing the popover is the whole action.
   */
  function pick(item: { id: string; status: "TO_BUY" | "BOUGHT" }) {
    if (item.status === "TO_BUY") {
      setOpen(false);
      return;
    }
    if (reactivate.isPending) return;
    setError(null);
    reactivate.mutate(item.id, {
      onSuccess: () => {
        setText("");
        setError(null);
      },
      onError: () => setError(GENERIC_ADD_ERROR),
    });
  }

  const groups =
    trimmed && suggestions.data
      ? suggestions.data.groups.filter((group) => group.category.id === categoryId)
      : [];
  const capped = capSuggestionGroups(groups, MAX_VISIBLE_SUGGESTIONS);
  const popoverOpen = open && trimmed.length > 0;
  const pending = createItem.isPending || reactivate.isPending;

  return (
    <div
      data-testid="add-item-box"
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      {popoverOpen ? (
        <div
          data-testid="suggestions-popover"
          className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          {trimmed ? (
            <button
              type="button"
              data-testid="create-item-row"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => create(trimmed)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-sm font-medium text-green-700 hover:bg-green-50"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-base"
              >
                +
              </span>
              <span className="truncate">Create "{trimmed}"</span>
            </button>
          ) : null}
          {capped.length > 0 ? (
            <ul aria-label="Suggestions">
              {capped.map((group) =>
                group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`suggestion-${item.id}`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => pick(item)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-gray-100"
                    >
                      <span
                        aria-hidden="true"
                        className="h-6 w-1.5 shrink-0 rounded"
                        style={{ backgroundColor: group.category.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                        {item.title}
                      </span>
                      {item.qtyText ? (
                        <span className="shrink-0 text-xs text-gray-500">{item.qtyText}</span>
                      ) : null}
                      {item.status === "BOUGHT" ? (
                        <span className="shrink-0 text-xs text-gray-400">bought</span>
                      ) : null}
                    </button>
                  </li>
                )),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create(text);
        }}
        className="flex items-center gap-2"
      >
        <input
          aria-label="Add item"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(event.target.value.trim().length > 0);
          }}
          placeholder="Add an item…"
          autoComplete="off"
          className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-base outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!trimmed || pending}
          className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
