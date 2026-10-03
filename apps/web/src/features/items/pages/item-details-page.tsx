import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiClientError } from "../../../lib/api-client";
import { useCategories } from "../../lists/hooks/use-categories";
import { ImageUpload } from "../components/image-upload";
import { ItemEditForm } from "../components/item-edit-form";
import { PriceChart } from "../components/price-chart";
import { PriceForm } from "../components/price-form";
import { useItemDetail } from "../hooks/use-item-detail";
import {
  useAddItemPrice,
  useDeleteItem,
  useUpdateItem,
  useUploadItemImage,
} from "../hooks/use-item-detail-mutations";
import { useItemListId } from "../hooks/use-item-list-id";

/**
 * Item details page (docs/TASKS.md → T18, the long-press / right-click target):
 * edit title/category/qty, upload a photo (downscaled client-side), and record
 * prices into the uplot history chart (each point labeled price + shop).
 * T41: the canonical route is `/lists/:listId/items/:itemId` — the owning list
 * comes from the URL (never navigation state), so reload/deep links keep the
 * category editable and Back returns to that exact list. Legacy `/items/:id`
 * deep links resolve the list from the payload (item caches, else
 * `GET /search`), then upgrade themselves to the canonical URL.
 */
export function ItemDetailsPage() {
  const { itemId = "", listId: routeListId } = useParams<{
    itemId: string;
    listId?: string;
  }>();
  const navigate = useNavigate();

  const detail = useItemDetail(itemId);
  const resolvedListId = useItemListId(itemId, detail.data);
  const listId = routeListId ?? resolvedListId;

  // A resolved legacy deep link upgrades to the canonical URL — Back then
  // returns to that list's main screen and the URL stays shareable.
  useEffect(() => {
    if (routeListId || !listId) return;
    navigate(`/lists/${listId}/items/${itemId}`, { replace: true });
  }, [routeListId, listId, itemId, navigate]);

  const categories = useCategories(listId);
  const updateItem = useUpdateItem(listId, itemId);
  const addPrice = useAddItemPrice(listId, itemId);
  const uploadImage = useUploadItemImage(listId, itemId);
  const removeItem = useDeleteItem(listId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (detail.isPending) {
    return (
      <main className="min-h-dvh bg-gray-50 px-4 pt-4">
        <output className="mx-auto block max-w-md text-sm text-gray-500">Loading item…</output>
      </main>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <main className="min-h-dvh bg-gray-50 px-4 pt-4">
        <p role="alert" className="mx-auto max-w-md text-sm text-red-600">
          Could not load this item. It may have been deleted or you have no access.
        </p>
      </main>
    );
  }

  const item = detail.data;
  const prices = item.prices;

  return (
    <main className="min-h-dvh bg-gray-50 px-4 pb-16 pt-4">
      <div className="mx-auto max-w-md space-y-6">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (listId ? navigate(`/lists/${listId}`) : navigate(-1))}
            aria-label="Back to the list"
            className="min-h-11 rounded-lg px-3 text-base font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Back
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-gray-900">
            {item.title}
          </h1>
          {item.status === "BOUGHT" ? (
            <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
              bought
            </span>
          ) : null}
        </header>

        <section
          aria-label="Item fields"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
        >
          <ItemEditForm
            item={item}
            categories={categories.data ?? null}
            pending={updateItem.isPending}
            error={updateItem.isError ? "Could not save the changes. Please try again." : null}
            onSave={(patch) => updateItem.mutate(patch)}
          />
        </section>

        <section
          aria-label="Item photo"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
        >
          <h2 className="text-sm font-medium text-gray-700">Photo</h2>
          <div className="mt-3">
            <ImageUpload
              imageFilename={item.imageFilename}
              itemTitle={item.title}
              pending={uploadImage.isPending}
              error={uploadImage.isError ? "Could not upload the photo. Please try again." : null}
              onUpload={(image, filename) => uploadImage.mutateAsync({ image, filename })}
            />
          </div>
        </section>

        <section
          aria-label="Price history"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
        >
          <h2 className="text-sm font-medium text-gray-700">Price history</h2>
          <div className="mt-3 border-b border-gray-100 pb-4">
            <PriceForm
              pending={addPrice.isPending}
              error={addPrice.isError ? "Could not add the price. Please try again." : null}
              onSave={(observation) => addPrice.mutate(observation)}
            />
          </div>
          {/* Chart below the form, in its own reserved layout space (T28). */}
          <div className="mt-4">
            <PriceChart observations={prices} />
          </div>
        </section>

        <section
          aria-label="Danger zone"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
        >
          <h2 className="text-sm font-medium text-gray-700">Danger zone</h2>
          {removeItem.isError ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {removeItem.error instanceof ApiClientError && removeItem.error.status === 403
                ? "You don't have permission to delete items in this list."
                : "Could not delete the item. Please try again."}
            </p>
          ) : null}
          {confirmingDelete ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={removeItem.isPending}
                onClick={() =>
                  removeItem.mutate(item.id, {
                    onSuccess: () => (listId ? navigate(`/lists/${listId}`) : navigate(-1)),
                  })
                }
                aria-label={`Confirm delete ${item.title}`}
                className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removeItem.isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={removeItem.isPending}
                onClick={() => setConfirmingDelete(false)}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${item.title}`}
              className="mt-3 min-h-11 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete item
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
