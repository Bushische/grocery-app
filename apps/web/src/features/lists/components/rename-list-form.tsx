import { type UpdateListRequest, updateListRequestSchema } from "@grocery/shared";
import { Field, Input, Label } from "@headlessui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

const inputClassName =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const buttonBaseClass =
  "min-h-10 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

interface RenameListFormProps {
  /** The title the form starts from (the list's current one). */
  currentTitle: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: UpdateListRequest) => void;
  onCancel: () => void;
}

/** Inline "rename list" form (RHF + shared zod schema — trim/empty rules identical to create). */
export function RenameListForm({
  currentTitle,
  pending,
  error,
  onSubmit,
  onCancel,
}: RenameListFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateListRequest>({
    resolver: zodResolver(updateListRequestSchema),
    defaultValues: { title: currentTitle },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="mt-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
      data-testid="rename-list-form"
    >
      <Field>
        <Label className={labelClassName}>List title</Label>
        <Input
          {...register("title")}
          autoFocus
          type="text"
          className={inputClassName}
          aria-label="New list title"
        />
        {errors.title ? (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {errors.title.message}
          </p>
        ) : null}
      </Field>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`${buttonBaseClass} text-gray-700 hover:bg-gray-100`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || isSubmitting}
          className={`${buttonBaseClass} bg-green-600 text-white hover:bg-green-700`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
