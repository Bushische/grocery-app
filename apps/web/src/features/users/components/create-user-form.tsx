import { type CreateUserRequest, createUserRequestSchema } from "@grocery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ApiClientError } from "../../../lib/api-client";
import { useCreateUser } from "../hooks/use-user-mutations";

const DUPLICATE_EMAIL_MESSAGE = "A user with this email already exists.";
const UNEXPECTED_ERROR_MESSAGE = "Could not create the user. Please try again.";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

/**
 * Create a user account (docs/TASKS.md → T32): email + password + role
 * (user/admin). RHF + the shared createUserRequestSchema (zod validates at the
 * boundary; the email is normalized trim+lowercase before it hits the API).
 */
export function CreateUserForm() {
  const create = useCreateUser();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: { email: "", password: "", role: "user" },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(values, { onSuccess: () => reset() });
  });

  const serverError = !create.isError
    ? null
    : create.error instanceof ApiClientError && create.error.status === 409
      ? DUPLICATE_EMAIL_MESSAGE
      : UNEXPECTED_ERROR_MESSAGE;

  return (
    <form
      noValidate
      aria-label="Create user"
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
    >
      <h2 className="text-sm font-semibold text-gray-900">Create user</h2>
      <div>
        <label htmlFor="user-email" className={labelClassName}>
          Email
        </label>
        <input
          id="user-email"
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
        <label htmlFor="user-password" className={labelClassName}>
          Password
        </label>
        <input
          id="user-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          {...register("password")}
          className={`mt-1 ${inputClassName}`}
        />
        {errors.password ? (
          <p role="alert" className={fieldErrorClassName}>
            {errors.password.message}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="user-role" className={labelClassName}>
          Role
        </label>
        <select
          id="user-role"
          {...register("role")}
          className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
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
        disabled={create.isPending}
        className="min-h-11 w-full rounded-lg bg-green-600 px-4 text-base font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {create.isPending ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}
