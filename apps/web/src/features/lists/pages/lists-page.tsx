import { useLogout } from "../../auth/hooks/use-logout";
import { useSession } from "../../auth/hooks/use-session";
import { useLists } from "../hooks/use-lists";

/**
 * T14 placeholder lists screen — proves "login → lists load" end-to-end.
 * The full lists view (tabs, create/delete) arrives in T15.
 */
export function ListsPage() {
  const { user } = useSession();
  const lists = useLists();
  const logout = useLogout();

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-semibold text-gray-900">My Groceries</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-6">
        {lists.status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading lists…</output>
        ) : lists.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            Could not load your lists.
          </p>
        ) : lists.data.length === 0 ? (
          <p className="text-sm text-gray-500">No lists yet.</p>
        ) : (
          <ul className="space-y-3">
            {lists.data.map((list) => (
              <li key={list.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="font-medium text-gray-900">{list.title}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {list.itemCounts.toBuy} to buy · {list.itemCounts.bought} bought
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
