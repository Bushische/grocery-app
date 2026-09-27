import { Navigate, Route, Routes } from "react-router-dom";
import { RedirectIfAuthenticated, RequireAuth } from "./features/auth/components/session-guards";
import { LoginPage } from "./features/auth/pages/login-page";
import { CategoriesPage } from "./features/categories/pages/categories-page";
import { CategoryItemsPage } from "./features/categories/pages/category-items-page";
import { ItemDetailsPage } from "./features/items/pages/item-details-page";
import { ListsPage } from "./features/lists/pages/lists-page";
import { MembersPage } from "./features/members/pages/members-page";

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
      <Route
        path="/items/:itemId"
        element={
          <RequireAuth>
            <ItemDetailsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/lists/:listId/categories"
        element={
          <RequireAuth>
            <CategoriesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/lists/:listId/members"
        element={
          <RequireAuth>
            <MembersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/categories/:categoryId"
        element={
          <RequireAuth>
            <CategoryItemsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
