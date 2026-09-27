import type { SuggestGroup } from "@grocery/shared";
import { useState } from "react";
import { useCreateItem } from "../hooks/use-create-item";
import { useSmartAdd } from "../hooks/use-smart-add";
import { useSuggest } from "../hooks/use-suggestions";

const GENERIC_ADD_ERROR = "Could not add the item. Please try again.";

/** Max suggestion rows rendered in the popover (docs/TASKS.md → T29).
 * The server may return more (up to 20, docs/API.md) — the client trims. */
export const MAX_VISIBLE_SUGGESTIONS = 3;

/**
 * Trims the server's grouped result to at most `max` items total, walking the
 * groups in server order (usageCount-first per docs/API.md → Suggest & Search)
 * and cutting each group off mid-list once the cap is reached.
 */
export function capSuggestionGroups(groups: SuggestGroup[], max: number): SuggestGroup[] {
  const capped: SuggestGroup[] = [];
  let remaining = max;
  for (const group of groups) {
    if (remaining <= 0) break;
    const items = group.items.slice(0, remaining);
    if (items.length === 0) continue;
    capped.push({ ...group, items });
    remaining -= items.length;
  }
  return capped;
}

export interface AddItemInputProps {
  listId: string;
}

/**
 * The bottom input box (docs/TASKS.md → T17): free text → suggestions debounced
 * 200 ms and grouped by category with color bars; Enter or tapping a suggestion
 * runs smart-add — matching an existing item re-activates it when bought,
 * unknown text creates an item in "Other" (docs/API.md → Items).
 *
 * The distinct "Create …" row (docs/TASKS.md → T26) bypasses smart-add: it uses
 * plain POST /lists/:id/items, which never matches — so "melon" can be created
 * next to an existing "watermelon" (a smart-add of "melon" would fuzzy-match it,
 * Dice("melon","watermelon") ≥ 0.6) and same-named items can be added twice.
 *
 * The suggestions + Create row live in a floating layer anchored above the
 * input (docs/TASKS.md → T29): absolutely positioned, out of the layout flow —
 * the input stays pinned to the bottom edge of the screen instead of being
 * pushed up. The layer caps suggestions at MAX_VISIBLE_SUGGESTIONS, opens on
 * typing, and closes on Escape, on blur that leaves the box, and after a
 * successful add/create (the cleared text hides it either way); a failed
 * add/create keeps it open so the action can be retried.
 *
 * Selection rows preventDefault on pointerdown: on browsers that do not focus
 * buttons on tap (iOS Safari) this keeps focus on the input, so the popover
 * never unmounts between the blur and the click and the tap always lands.
 * A blur with the focus moving inside the box (relatedTarget) keeps it open.
 *
 * No virtualization: the popover shows at most MAX_VISIBLE_SUGGESTIONS rows.
 */
export function AddItemInput({ listId }: AddItemInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const suggestions = useSuggest(listId, text);
  const smartAdd = useSmartAdd(listId);
  const createItem = useCreateItem(listId);

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

  /** Explicit create (T26): plain item creation, never a match. */
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

  const groups =
    trimmed && suggestions.data
      ? suggestions.data.groups.filter((group) => group.items.length > 0)
      : [];
  const capped = capSuggestionGroups(groups, MAX_VISIBLE_SUGGESTIONS);
  const popoverOpen = open && trimmed.length > 0;

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
              {capped.map((group) => (
                <SuggestionGroup key={group.category.id} group={group} onSelect={add} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
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
              onPointerDown={(event) => event.preventDefault()}
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
