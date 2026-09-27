import type { Item } from "@grocery/shared";

export interface CategoryItemRowProps {
  item: Item;
  onOpenDetails: (itemId: string) => void;
}

/**
 * Read-only row of the category's item view (docs/TASKS.md → T19): category
 * color bar, title, quantity, status badge; tap opens the item details where
 * all edits happen.
 */
export function CategoryItemRow({ item, onOpenDetails }: CategoryItemRowProps) {
  return (
    <li
      data-testid={`category-item-${item.id}`}
      className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200"
    >
      <button
        type="button"
        onClick={() => onOpenDetails(item.id)}
        aria-label={`Open details for ${item.title}`}
        className="flex min-h-11 w-full items-stretch text-left hover:bg-gray-50"
      >
        <span
          aria-hidden="true"
          className="w-1.5 shrink-0 self-stretch"
          style={{ backgroundColor: item.category.color }}
        />
        <span className="min-w-0 flex-1 py-2.5 pl-3">
          <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
          {item.qtyText ? (
            <span className="block text-xs text-gray-500">{item.qtyText}</span>
          ) : null}
        </span>
        <span className="shrink-0 self-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
          {item.status === "TO_BUY" ? "to buy" : "bought"}
        </span>
      </button>
    </li>
  );
}
