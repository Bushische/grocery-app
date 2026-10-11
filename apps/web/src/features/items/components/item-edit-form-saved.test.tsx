// @vitest-environment jsdom
import type { Category, Item } from "@grocery/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { ItemEditForm } from "./item-edit-form";

const CATEGORY: Category = { id: "c1", title: "Other", color: "#6B7280" } as Category;
const CATEGORIES: Category[] = [{ ...CATEGORY, sortOrder: 0, itemCount: 1 } as Category];
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
    category: { id: "c1", title: "Other", color: "#6B7280" },
    imageFilename: null,
    currentPrice: null,
  };
}

function renderForm(onSave: (patch: unknown) => unknown = async () => undefined) {
  const save = vi.fn(onSave);
  render(
    <ItemEditForm
      item={testItem()}
      categories={CATEGORIES}
      pending={false}
      error={null}
      onSave={save}
    />,
  );
  return { save };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Save changes|Saving…|Saved)$/ });
}

describe("ItemEditForm Saved feedback (T92)", () => {
  it("starts shaded and inactive with Save changes", () => {
    renderForm();

    const button = saveButton();
    expect(button).toHaveTextContent("Save changes");
    expect(button).toBeDisabled();
    expect(button.className).toMatch(/opacity-60/);
  });

  it("shows Saved, shaded and inactive after a confirmed save", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText("Title"), " Oat");
    expect(saveButton()).toHaveTextContent("Save changes");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    expect(save).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("re-arms to Save changes on the next edit after a save", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Title"), " Oat");
    await user.click(saveButton());
    await screen.findByRole("button", { name: "Saved" });

    await user.type(screen.getByLabelText("Quantity (optional)"), "2x");

    const button = saveButton();
    expect(button).toHaveTextContent("Save changes");
    expect(button).toBeEnabled();
  });

  it("keeps Save changes active for retry when the save rejects", async () => {
    const user = userEvent.setup();
    const { save } = renderForm(async () => {
      throw new Error("offline");
    });

    await user.type(screen.getByLabelText("Title"), " Oat");
    await user.click(saveButton());
    expect(save).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(saveButton()).toHaveTextContent("Save changes");
    expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
  });
});
