import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { hexColorSchema, titleSchema } from "@grocery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

/** Form-level schema — the wire body is re-validated by updateCategoryRequestSchema. */
const categoryFormSchema = z.object({
  title: titleSchema,
  color: hexColorSchema,
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export interface CategoryEditorProps {
  category: Category;
  pending: boolean;
  error: string | null;
  onSave: (patch: UpdateCategoryRequest) => void;
  onCancel: () => void;
}

/** Inline editor for one category's title + color (docs/TASKS.md → T19). */
export function CategoryEditor({
  category,
  pending,
  error,
  onSave,
  onCancel,
}: CategoryEditorProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { title: category.title, color: category.color },
  });

  return (
    <form
      noValidate
      aria-label={`Edit ${category.title}`}
      onSubmit={handleSubmit((values) => onSave({ title: values.title, color: values.color }))}
      className="space-y-3 p-3"
    >
      <div>
        <label htmlFor={`category-title-${category.id}`} className={labelClassName}>
          Title
        </label>
        <input
          id={`category-title-${category.id}`}
          type="text"
          {...register("title")}
          className={`mt-1 ${inputClassName}`}
        />
        {errors.title ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.title.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor={`category-color-${category.id}`} className={labelClassName}>
          Color
        </label>
        <input
          id={`category-color-${category.id}`}
          type="color"
          {...register("color")}
          className="mt-1 block h-11 w-20 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
        />
        {errors.color ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.color.message}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 flex-1 rounded-lg bg-green-600 px-4 text-base font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="min-h-11 rounded-lg px-4 text-base font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
