import { useNavigate } from "react-router-dom";
import { ApiClientError } from "../../../lib/api-client";
import { useSession } from "../../auth/hooks/use-session";
import { CreateUserForm } from "../components/create-user-form";
import { UserList } from "../components/user-list";
import { useDeleteUser } from "../hooks/use-user-mutations";
import { useUsers } from "../hooks/use-users";

const OWNS_LISTS_MESSAGE = "This user owns lists and cannot be deleted.";
const UNEXPECTED_DELETE_ERROR = "Could not delete the user. Please try again.";

/**
 * Admin users page (docs/TASKS.md → T32): list all users (email, role,
 * createdAt), create users (RHF + the shared createUserRequestSchema), delete
 * users with confirm (409 while they own lists). The entry point is the T30
 * overlay menu's admin block; a non-admin deep link gets a blocked notice and
 * the user list is never fetched (T20 pattern — gate before query).
 */
export function UsersPage() {
  const navigate = useNavigate();
  const { status, user } = useSession();
  const isAdmin = user?.role === "admin";
  const users = useUsers(isAdmin);
  const remove = useDeleteUser();

  const deleteError = !remove.isError
    ? null
    : remove.error instanceof ApiClientError && remove.error.status === 409
      ? OWNS_LISTS_MESSAGE
      : UNEXPECTED_DELETE_ERROR;

  return (
    <main className="min-h-dvh bg-gray-50 px-4 pb-16 pt-4">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="min-h-11 rounded-lg px-3 text-base font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-gray-900">Users</h1>
            <p className="truncate text-sm text-gray-500">Manage accounts</p>
          </div>
        </header>

        {status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading…</output>
        ) : isAdmin ? (
          users.status === "pending" ? (
            <output className="block text-sm text-gray-500">Loading users…</output>
          ) : users.status === "error" ? (
            <p role="alert" className="text-sm text-red-600">
              Could not load the users.
            </p>
          ) : (
            <>
              <CreateUserForm />
              <UserList
                users={users.data}
                deletePending={remove.isPending}
                deleteError={deleteError}
                onDelete={(userId) => remove.mutate(userId)}
              />
            </>
          )
        ) : (
          <p className="text-sm text-gray-500">Only admins can manage users.</p>
        )}
      </div>
    </main>
  );
}
