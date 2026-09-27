import type { Category, Item, UpdateItemRequest } from "@grocery/shared";
import { titleSchema } from "@grocery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

/** Form-level schema — the wire body is re-validated by updateItemRequestSchema. */
const itemFormSchema = z.object({
  title: titleSchema,
  categoryId: z.string().min(1),
  qty: z.string(),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;

export interface ItemEditFormProps {
  item: Item;
  /** Categories of the item's list; null when the list context is unknown. */
  categories: Category[] | null;
  pending: boolean;
  error: string | null;
  onSave: (patch: UpdateItemRequest) => void;
}

/**
 * The item's editable fields (docs/TASKS.md → T18): title, category select,
 * quantity. An empty quantity clears `qtyText` on the server (`qtyText: null`).
 */
export function ItemEditForm({ item, categories, pending, error, onSave }: ItemEditFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      title: item.title,
      categoryId: item.category.id,
      qty: item.qtyText ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    const qty = values.qty.trim();
    onSave({
      title: values.title,
      categoryId: values.categoryId,
      qtyText: qty === "" ? null : qty,
    });
  });

  // Without the list context the category stays read-only (deep-linked detail).
  const categoryOptions = categories ?? [{ ...item.category, sortOrder: 0, itemCount: 0 }];

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="item-title" className={labelClassName}>
          Title
        </label>
        <input
          id="item-title"
          {...register("title")}
          type="text"
          className={`mt-1 ${inputClassName}`}
        />
        {errors.title ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.title.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="item-category" className={labelClassName}>
          Category
        </label>
        {categories ? (
          <select
            id="item-category"
            {...register("categoryId")}
            className={`mt-1 ${inputClassName}`}
          >
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-1 flex min-h-11 items-center rounded-lg bg-gray-100 px-3 text-base text-gray-700">
            {item.category.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="item-qty" className={labelClassName}>
          Quantity (optional)
        </label>
        <input
          id="item-qty"
          {...register("qty")}
          type="text"
          placeholder="e.g. 2x or 500g"
          className={`mt-1 ${inputClassName}`}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !isDirty}
        className="min-h-11 w-full rounded-lg bg-green-600 px-4 text-base font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
