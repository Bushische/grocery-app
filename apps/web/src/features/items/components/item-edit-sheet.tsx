import type { Item } from "@grocery/shared";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { useCallback, useRef, useState } from "react";
import { useCategories } from "../../lists/hooks/use-categories";
import { useUpdateItem } from "../hooks/use-item-detail-mutations";
import { ImageLightbox } from "./image-lightbox";
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
 * T90: when the item has a photo, a small thumbnail opens the shared
 * full-screen `ImageLightbox` (same testids/behavior as T46); focus returns
 * to the thumbnail on close. No photo renders no thumbnail.
 */
export function ItemEditSheet({ item, listId, open, onClose, onOpenDetails }: ItemEditSheetProps) {
  const updateItem = useUpdateItem(listId, item.id);
  const categories = useCategories(listId);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const thumbnailRef = useRef<HTMLButtonElement | null>(null);

  const photoSrc = item.imageFilename != null ? `/static/${item.imageFilename}` : null;
  const photoAlt = `${item.title} (stored)`;

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    // Restore focus to the thumbnail — the overlay that held focus is unmounting.
    thumbnailRef.current?.focus();
  }, []);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end justify-center p-4">
        <DialogPanel
          data-testid={`edit-sheet-${item.id}`}
          className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl"
        >
          <DialogTitle className="text-sm font-medium text-gray-700">Edit {item.title}</DialogTitle>
          {photoSrc ? (
            <button
              ref={thumbnailRef}
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`${item.title} photo, open full size`}
              data-testid={`edit-sheet-photo-${item.id}`}
              className="mt-3 block min-h-11 min-w-11 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
            >
              <img src={photoSrc} alt={photoAlt} className="h-16 w-16 rounded-lg object-cover" />
            </button>
          ) : null}
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
      {lightboxOpen && photoSrc ? (
        <ImageLightbox src={photoSrc} alt={photoAlt} onClose={closeLightbox} />
      ) : null}
    </Dialog>
  );
}
