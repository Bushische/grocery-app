import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../hooks/use-session";

/** Full-screen splash shown while the silent refresh is in flight. */
function SessionSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <output className="block text-sm text-gray-500">Loading…</output>
    </div>
  );
}

/** Renders children only for authenticated users; anonymous users go to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "pending") return <SessionSplash />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Wraps public-only pages (login): authenticated users go to /. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "pending") return <SessionSplash />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}
