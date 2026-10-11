import type { Category } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { createApiFetchMock } from "../../../test/mock-api";
import { CategoryCombobox } from "../../items/components/category-select";
import { CategoryList } from "./category-list";
import { CategoryListContainer } from "./category-list-container";

const DAIRY: Category = {
  id: "c1",
  title: "Dairy",
  color: "#3B82F6",
  sortOrder: 0,
  itemCount: 2,
};
const BAKERY: Category = {
  id: "c2",
  title: "Bakery",
  color: "#F59E0B",
  sortOrder: 1,
  itemCount: 0,
};

const noop = () => undefined;

function baseProps() {
  return {
    categories: [DAIRY, BAKERY],
    canEdit: true,
    canDelete: true,
    canReorder: true,
    editingId: null,
    confirmingDeleteId: null,
    updatePending: false,
    updateError: null,
    deletePending: false,
    deleteError: null,
    reorderError: null,
    onStartEdit: noop,
    onCancelEdit: noop,
    onSaveEdit: noop,
    onStartDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    onViewItems: noop,
    onReorder: noop,
  };
}

function renderContainer(props?: { canEdit: boolean; onViewItems?: (id: string) => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CategoryListContainer
        listId="l1"
        categories={[DAIRY, BAKERY]}
        canEdit={props?.canEdit ?? true}
        canDelete={false}
        onViewItems={props?.onViewItems ?? noop}
      />
    </QueryClientProvider>,
  );
}

describe("CategoryList drag handles (T94)", () => {
  it("1. shows a ≡ handle per row for EDITOR+", () => {
    render(<CategoryList {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Reorder Dairy" })).toHaveAttribute(
      "data-testid",
      "handle-c1",
    );
    expect(screen.getByRole("button", { name: "Reorder Bakery" })).toHaveAttribute(
      "data-testid",
      "handle-c2",
    );
  });

  it("VIEWER sees no handles", () => {
    render(<CategoryList {...baseProps()} canReorder={false} />);
    expect(screen.queryByRole("button", { name: "Reorder Dairy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reorder Bakery" })).not.toBeInTheDocument();
  });

  it("3. VIEWER issues no reorder calls and sees no handles", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    const onViewItems = vi.fn();
    renderContainer({ canEdit: false, onViewItems });

    expect(await screen.findByTestId("category-row-c1")).toBeInTheDocument();
    expect(screen.queryByTestId("handle-c1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("handle-c2")).not.toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/lists/l1/categories/reorder")).toHaveLength(0);

    // The rows stay navigable without any drag affordance.
    await userEvent.setup().click(screen.getByRole("button", { name: "View items in Dairy" }));
    expect(onViewItems).toHaveBeenCalledWith("c1");
  });

  it("4. shows the reorder failure banner (the mutation rolls the order back)", () => {
    render(
      <CategoryList
        {...baseProps()}
        reorderError="Could not save the new order. Please try again."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save the new order. Please try again.",
    );
  });

  it("6. tapping a row opens the items view; only the handle carries the drag affordance", async () => {
    const onViewItems = vi.fn();
    render(<CategoryList {...baseProps()} onViewItems={onViewItems} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "View items in Dairy" }));
    expect(onViewItems).toHaveBeenCalledWith("c1");

    // The ≡ handle is the sortable activator; the row body is a plain tap target.
    expect(screen.getByTestId("handle-c1")).toHaveAttribute("aria-roledescription", "sortable");
    expect(screen.getByRole("button", { name: "View items in Dairy" })).not.toHaveAttribute(
      "aria-roledescription",
    );
  });

  it("5. the item-edit category picker follows the reordered categories", async () => {
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        categories={[
          { id: "c2", title: "Bakery", color: "#F59E0B" },
          { id: "c1", title: "Dairy", color: "#3B82F6" },
        ]}
        value="c1"
        onChange={noop}
      />,
    );
    await user.click(screen.getByLabelText("Category"));
    const list = await screen.findByTestId("category-combobox-list");
    const options = within(list).getAllByTestId(/category-option-/);
    expect(options.map((option) => option.getAttribute("data-testid"))).toEqual([
      "category-option-c2",
      "category-option-c1",
    ]);
  });
});
