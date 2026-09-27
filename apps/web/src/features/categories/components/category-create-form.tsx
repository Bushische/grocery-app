import { hexColorSchema, titleSchema } from "@grocery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

/** Form-level schema — the wire body is re-validated by createCategoryRequestSchema. */
const categoryFormSchema = z.object({
  title: titleSchema,
  color: hexColorSchema,
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export interface CategoryCreateFormProps {
  pending: boolean;
  error: string | null;
  onCreate: (body: { title: string; color: string }) => void;
  onCancel: () => void;
}

/**
 * "New category" form (docs/TASKS.md → T25): title + color picker, RHF +
 * shared zod schemas (docs/CONVENTIONS.md → Frontend). Rendered on the
 * category management page whenever the user asks to add a category.
 */
export function CategoryCreateForm({
  pending,
  error,
  onCreate,
  onCancel,
}: CategoryCreateFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { title: "", color: "#3B82F6" },
  });

  return (
    <form
      noValidate
      aria-label="Create category"
      onSubmit={handleSubmit((values) => onCreate({ title: values.title, color: values.color }))}
      className="space-y-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
    >
      <div>
        <label htmlFor="new-category-title" className={labelClassName}>
          Title
        </label>
        <input
          id="new-category-title"
          type="text"
          placeholder="e.g. Produce"
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
        <label htmlFor="new-category-color" className={labelClassName}>
          Color
        </label>
        <input
          id="new-category-color"
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
          {pending ? "Creating…" : "Create"}
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
