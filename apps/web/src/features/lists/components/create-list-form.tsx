import { type CreateListRequest, createListRequestSchema } from "@grocery/shared";
import { Field, Input, Label } from "@headlessui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

const inputClassName =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const buttonBaseClass =
  "min-h-10 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

interface CreateListFormProps {
  pending: boolean;
  error: string | null;
  onSubmit: (values: CreateListRequest) => void;
  onCancel: () => void;
}

/** Inline "new list" form (RHF + shared zod schema, docs/CONVENTIONS.md → Frontend). */
export function CreateListForm({ pending, error, onSubmit, onCancel }: CreateListFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateListRequest>({
    resolver: zodResolver(createListRequestSchema),
    defaultValues: { title: "" },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="mt-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
    >
      <Field>
        <Label className={labelClassName}>List title</Label>
        <Input
          {...register("title")}
          autoFocus
          type="text"
          placeholder="e.g. Weekly"
          className={inputClassName}
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
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
