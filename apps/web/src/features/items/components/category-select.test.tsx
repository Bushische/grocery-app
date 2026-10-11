// @vitest-environment jsdom
import type { Category, Item } from "@grocery/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { ItemEditForm } from "./item-edit-form";

const DAIRY: Category = {
  id: "c1",
  title: "Dairy",
  color: "#3B82F6",
  sortOrder: 0,
  itemCount: 1,
} as Category;
const BAKERY: Category = {
  id: "c2",
  title: "Bakery",
  color: "#F59E0B",
  sortOrder: 1,
  itemCount: 0,
} as Category;
const ADDED_AT = "2026-09-24T08:00:00.000Z";

function testItem(): Item {
  return {
    id: "i1",
    title: "Milk",
    qtyText: null,
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: { id: "c1", title: "Dairy", color: "#3B82F6" },
    imageFilename: null,
    currentPrice: null,
  };
}

function renderForm(categories: Category[] | null = [DAIRY, BAKERY]) {
  const save = vi.fn(async () => undefined);
  render(
    <ItemEditForm
      item={testItem()}
      categories={categories}
      pending={false}
      error={null}
      onSave={save}
    />,
  );
  return { save };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Category"));
  return await screen.findByTestId("category-combobox-list");
}

describe("CategoryCombobox in ItemEditForm (T93)", () => {
  it("1. shows every category with its swatch in API order", async () => {
    const user = userEvent.setup();
    renderForm();

    const list = await openPicker(user);
    const dairy = within(list).getByTestId("category-option-c1");
    const bakery = within(list).getByTestId("category-option-c2");
    expect(dairy).toHaveTextContent("Dairy");
    expect(bakery).toHaveTextContent("Bakery");
    expect(within(dairy).getByTestId("category-swatch-c1")).toHaveStyle({
      backgroundColor: "#3B82F6",
    });
    expect(within(bakery).getByTestId("category-swatch-c2")).toHaveStyle({
      backgroundColor: "#F59E0B",
    });
    expect(dairy.compareDocumentPosition(bakery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("2. typing narrows the list by substring", async () => {
    const user = userEvent.setup();
    renderForm();

    await openPicker(user);
    // Drive the filter directly: jsdom/user-event cannot reproduce the
    // browser's focus-select-all, so typing here would append to "Dairy".
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "bak" } });

    const list = screen.getByTestId("category-combobox-list");
    expect(within(list).queryByTestId("category-option-c1")).not.toBeInTheDocument();
    expect(within(list).getByTestId("category-option-c2")).toBeInTheDocument();
  });

  it("3. picking a category shows its swatch and saves its id", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();

    await openPicker(user);
    await user.click(screen.getByTestId("category-option-c2"));

    expect(screen.getByLabelText("Category")).toHaveValue("Bakery");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: "c2", title: "Milk" }),
      ),
    );
  });

  it("4. keyboard-only selection works", async () => {
    const user = userEvent.setup();
    renderForm();

    await openPicker(user);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Category")).toHaveValue("Bakery");
  });

  it("5. unknown list context keeps the read-only category title", () => {
    renderForm(null);

    expect(screen.getByText("Dairy")).toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.queryByTestId("category-combobox-list")).not.toBeInTheDocument();
  });

  it("6. T92 Saved and re-arm behavior is unchanged", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Title"), " Oat");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();

    await user.type(screen.getByLabelText("Quantity (optional)"), "2x");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
});
