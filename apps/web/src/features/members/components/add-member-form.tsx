import { type AddListMemberRequest, addListMemberRequestSchema } from "@grocery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ApiClientError } from "../../../lib/api-client";
import { useAddMember } from "../hooks/use-member-mutations";

const UNKNOWN_EMAIL_MESSAGE = "No user with this email has an account yet.";
const ALREADY_MEMBER_MESSAGE = "This user is already a member of the list.";
const UNEXPECTED_ERROR_MESSAGE = "Could not add the member. Please try again.";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

/**
 * Add a member by email (docs/TASKS.md → T20). The role choice is limited to
 * EDITOR/VIEWER: docs/PROJECT.md models exactly one OWNER per list, and the
 * owner's membership row can never be changed or removed (server 409s).
 */
export function AddMemberForm({ listId }: { listId: string }) {
  const add = useAddMember(listId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddListMemberRequest>({
    resolver: zodResolver(addListMemberRequestSchema),
    defaultValues: { email: "", role: "EDITOR" },
  });

  const onSubmit = handleSubmit((values) => {
    add.mutate(values, { onSuccess: () => reset() });
  });

  const serverError = !add.isError
    ? null
    : add.error instanceof ApiClientError && add.error.status === 404
      ? UNKNOWN_EMAIL_MESSAGE
      : add.error instanceof ApiClientError && add.error.status === 409
        ? ALREADY_MEMBER_MESSAGE
        : UNEXPECTED_ERROR_MESSAGE;

  return (
    <form
      noValidate
      aria-label="Add member"
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
    >
      <h2 className="text-sm font-semibold text-gray-900">Add member</h2>
      <div>
        <label htmlFor="member-email" className={labelClassName}>
          Email
        </label>
        <input
          id="member-email"
          type="email"
          autoComplete="email"
          placeholder="mom@example.com"
          {...register("email")}
          className={`mt-1 ${inputClassName}`}
        />
        {errors.email ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.email.message}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="member-role" className={labelClassName}>
          Role
        </label>
        <select
          id="member-role"
          {...register("role")}
          className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600"
        >
          <option value="EDITOR">Editor</option>
          <option value="VIEWER">Viewer</option>
        </select>
        {errors.role ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.role.message}
          </p>
        ) : null}
      </div>
      {serverError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={add.isPending}
        className="min-h-11 w-full rounded-lg bg-green-600 px-4 text-base font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {add.isPending ? "Adding…" : "Add member"}
      </button>
    </form>
  );
}
