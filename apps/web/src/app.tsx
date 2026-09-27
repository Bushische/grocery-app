import { Navigate, Route, Routes } from "react-router-dom";
import { RedirectIfAuthenticated, RequireAuth } from "./features/auth/components/session-guards";
import { LoginPage } from "./features/auth/pages/login-page";
import { ListsPage } from "./features/lists/pages/lists-page";

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ListsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
