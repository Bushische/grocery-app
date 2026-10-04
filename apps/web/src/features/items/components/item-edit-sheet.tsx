import type { Item } from "@grocery/shared";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { useCategories } from "../../lists/hooks/use-categories";
import { useUpdateItem } from "../hooks/use-item-detail-mutations";
import { ItemEditForm } from "./item-edit-form";

export interface ItemEditSheetProps {
  item: Item;
  listId: string;
  open: boolean;
  onClose: () => void;
  onOpenDetails: (itemId: string) => void;
}

/**
 * Bottom-sheet editor for one row (T84): the swipe-left commit and the
 * revealed Edit button land here instead of navigating to the details page.
 * Reuses `ItemEditForm` (title/qty/category) with the list's categories;
 * saving invalidates the list caches via `useUpdateItem` and closes.
 * T86: an `Open full details` action digs into the details page (photos,
 * prices, danger zone) and closes the sheet.
 */
export function ItemEditSheet({ item, listId, open, onClose, onOpenDetails }: ItemEditSheetProps) {
  const updateItem = useUpdateItem(listId, item.id);
  const categories = useCategories(listId);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end justify-center p-4">
        <DialogPanel
          data-testid={`edit-sheet-${item.id}`}
          className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl"
        >
          <DialogTitle className="text-sm font-medium text-gray-700">Edit {item.title}</DialogTitle>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenDetails(item.id);
            }}
            data-testid={`full-details-${item.id}`}
            className="mt-2 min-h-11 w-full rounded-lg px-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Open full details
          </button>
          <div className="mt-3">
            <ItemEditForm
              item={item}
              categories={categories.data ?? null}
              pending={updateItem.isPending}
              error={updateItem.isError ? "Could not save the changes. Please try again." : null}
              onSave={(patch) =>
                updateItem.mutate(patch, {
                  onSuccess: onClose,
                })
              }
            />
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
