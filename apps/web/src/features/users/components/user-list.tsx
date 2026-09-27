import type { UserDto } from "@grocery/shared";
import { useState } from "react";

export interface UserListProps {
  users: UserDto[];
  deletePending: boolean;
  deleteError: string | null;
  onDelete: (userId: string) => void;
}

const ROLE_LABELS: Record<UserDto["role"], string> = {
  user: "User",
  admin: "Admin",
};

const buttonBaseClass =
  "min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The admin user list (docs/TASKS.md → T32): email, role, createdAt, and a
 * two-step-confirmed delete. A 409 (the user still owns lists) surfaces as a
 * banner above the list while the row stays.
 */
export function UserList({ users, deletePending, deleteError, onDelete }: UserListProps) {
  // Two-step confirm is per row — at most one row asks for confirmation.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {deleteError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </p>
      ) : null}
      <ul aria-label="Users" className="space-y-2">
        {users.map((user) => {
          const confirming = confirmingId === user.id;
          return (
            <li
              key={user.id}
              data-testid={`user-row-${user.id}`}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 shadow-sm ring-1 ring-gray-200"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {user.email}
                </span>
                <span className="block text-xs text-gray-500">
                  Joined {user.createdAt.slice(0, 10)}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                  user.role === "admin"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {ROLE_LABELS[user.role]}
              </span>
              {confirming ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">Delete this user?</span>
                  <button
                    type="button"
                    onClick={() => onDelete(user.id)}
                    disabled={deletePending}
                    className={`${buttonBaseClass} bg-red-600 text-white hover:bg-red-700`}
                  >
                    {deletePending ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={deletePending}
                    className={`${buttonBaseClass} text-gray-700 hover:bg-gray-100`}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(user.id)}
                  disabled={deletePending}
                  aria-label={`Delete ${user.email}`}
                  className={`${buttonBaseClass} text-red-600 hover:bg-red-50`}
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {users.length === 0 ? (
        <p className="text-sm text-gray-500">No users yet — create one above.</p>
      ) : null}
    </div>
  );
}
