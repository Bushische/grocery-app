// @vitest-environment jsdom
import type { Item } from "@grocery/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { ItemEditSheet } from "./item-edit-sheet";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;
const CATEGORIES = [{ id: "c1", title: "Other", color: "#6B7280", sortOrder: 0, itemCount: 1 }];
const ADDED_AT = "2026-09-24T08:00:00.000Z";

function itemWithPhoto(): Item {
  return {
    id: "i1",
    title: "Milk",
    qtyText: null,
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: CATEGORY,
    imageFilename: "i1-abc.webp",
    currentPrice: null,
  };
}

function renderSheet(item: Item) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
  const mock = createApiFetchMock();
  mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
  mock.stub();
  const onClose = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ItemEditSheet item={item} listId="l1" open onClose={onClose} onOpenDetails={onOpenDetails} />
    </QueryClientProvider>,
  );
}

describe("ItemEditSheet photo thumbnail (T90)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("shows a small thumbnail with the stored src/alt when a photo is attached", async () => {
    renderSheet(itemWithPhoto());

    const thumbnail = await screen.findByTestId("edit-sheet-photo-i1");
    expect(thumbnail.tagName).toBe("BUTTON");
    const img = screen.getByRole("img", { name: "Milk (stored)" });
    expect(thumbnail).toContainElement(img);
    expect(img).toHaveAttribute("src", "/static/i1-abc.webp");
    expect(img).toHaveAttribute("alt", "Milk (stored)");
    expect(img.className).toContain("object-cover");
  });

  it("renders no thumbnail when the item has no photo", async () => {
    renderSheet({ ...itemWithPhoto(), imageFilename: null });

    expect(await screen.findByTestId("edit-sheet-i1")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-sheet-photo-i1")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("tapping the thumbnail opens the full-screen lightbox with the same src", async () => {
    const user = userEvent.setup();
    renderSheet(itemWithPhoto());

    await user.click(await screen.findByTestId("edit-sheet-photo-i1"));

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
    const backdrop = screen.getByTestId("lightbox-backdrop");
    expect(backdrop.className).toContain("bg-black/80");
    const dialog = screen.getByRole("dialog", { name: "Item photo, full size" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/static/i1-abc.webp");
  });

  it("closes via the ✕ button and restores focus to the thumbnail", async () => {
    const user = userEvent.setup();
    renderSheet(itemWithPhoto());

    await user.click(await screen.findByTestId("edit-sheet-photo-i1"));
    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();

    await user.click(screen.getByTestId("lightbox-close"));

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-sheet-photo-i1")).toHaveFocus();
  });

  it("closes on Escape and restores focus to the thumbnail", async () => {
    const user = userEvent.setup();
    renderSheet(itemWithPhoto());

    await user.click(await screen.findByTestId("edit-sheet-photo-i1"));
    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-sheet-photo-i1")).toHaveFocus();
  });

  it("closes on a backdrop tap and restores focus to the thumbnail", async () => {
    const user = userEvent.setup();
    renderSheet(itemWithPhoto());

    await user.click(await screen.findByTestId("edit-sheet-photo-i1"));
    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();

    await user.click(screen.getByTestId("lightbox-backdrop"));

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-sheet-photo-i1")).toHaveFocus();
  });

  it("tapping the photo inside the lightbox keeps it open", async () => {
    const user = userEvent.setup();
    renderSheet(itemWithPhoto());

    await user.click(await screen.findByTestId("edit-sheet-photo-i1"));

    await user.click(screen.getByTestId("lightbox-image"));

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
  });
});
