// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stubImagePipeline, stubObjectUrls } from "../../../test/image-stub";
import { ImageUpload, type ImageUploadProps } from "./image-upload";
import "../../../test/setup";

function renderUpload(over: Partial<ImageUploadProps> = {}) {
  const onUpload = over.onUpload ?? vi.fn(async () => undefined);
  render(
    <ImageUpload
      imageFilename="i1-abc.webp"
      itemTitle="Milk"
      pending={false}
      error={null}
      onUpload={onUpload}
      {...over}
    />,
  );
  return { onUpload };
}

describe("ImageUpload (docs/TASKS.md → T46)", () => {
  it("renders the stored photo large: full card width, h-52 object-cover, tappable", () => {
    renderUpload();

    const image = screen.getByTestId("item-image");
    expect(image).toHaveAttribute("src", "/static/i1-abc.webp");
    expect(image).toHaveAttribute("alt", "Milk (stored)");
    expect(image.className).toContain("w-full");
    expect(image.className).toContain("h-52");
    expect(image.className).toContain("object-cover");
    // The tappable affordance is the wrapping button, controls below it.
    const trigger = screen.getByRole("button", { name: "Milk (stored)" });
    expect(trigger).toContainElement(image);
    const controls = screen.getByRole("button", { name: /Upload photo/i });
    expect(
      trigger.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("tapping the stored photo opens a full-screen lightbox (DoD)", async () => {
    const user = userEvent.setup();
    renderUpload();

    await user.click(screen.getByRole("button", { name: "Milk (stored)" }));

    const overlay = screen.getByTestId("image-lightbox");
    expect(overlay.className).toContain("fixed");
    const backdrop = screen.getByTestId("lightbox-backdrop");
    expect(backdrop).toHaveAttribute("aria-label", "Close photo view");
    expect(backdrop.className).toContain("bg-black/80");
    const dialog = screen.getByRole("dialog", { name: "Item photo, full size" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const lightboxImage = screen.getByTestId("lightbox-image");
    expect(lightboxImage).toHaveAttribute("src", "/static/i1-abc.webp");
    expect(lightboxImage.className).toContain("object-contain");
    // The ✕ close target is ≥ 40 px (min-h-11 / min-w-11).
    const close = screen.getByTestId("lightbox-close");
    expect(close).toHaveAttribute("aria-label", "Close photo view");
    expect(close.className).toContain("min-h-11");
    expect(close.className).toContain("min-w-11");
    // Focus moved into the overlay on open.
    expect(dialog).toHaveFocus();
  });

  it("closes the lightbox via the ✕ button and restores focus to the preview", async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.click(screen.getByRole("button", { name: "Milk (stored)" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByTestId("lightbox-close"));

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Milk (stored)" })).toHaveFocus();
  });

  it("closes the lightbox on Escape", async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.click(screen.getByRole("button", { name: "Milk (stored)" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
  });

  it("closes the lightbox on a backdrop tap", async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.click(screen.getByRole("button", { name: "Milk (stored)" }));

    await user.click(screen.getByTestId("lightbox-backdrop"));

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
  });

  it("tapping the photo inside the lightbox keeps it open", async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.click(screen.getByRole("button", { name: "Milk (stored)" }));

    await user.click(screen.getByTestId("lightbox-image"));

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
  });

  it("keeps the upload flow unchanged: pre-upload preview is large + tappable, upload still round-trips", async () => {
    stubImagePipeline({ width: 2400, height: 1800 });
    const objectUrls = stubObjectUrls();
    const onUpload = vi.fn(async () => undefined);
    renderUpload({ imageFilename: null, onUpload });
    const user = userEvent.setup();

    expect(screen.getByText("No photo")).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Choose photo"),
      new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }),
    );

    // The pre-upload preview is the same large, tappable presentation.
    const preview = screen.getByTestId("item-image-preview");
    expect(preview).toHaveAttribute("src", "blob:preview-1");
    expect(preview.className).toContain("w-full");
    expect(preview.className).toContain("h-52");
    const trigger = screen.getByRole("button", { name: "Milk — newly chosen preview" });
    expect(trigger).toContainElement(preview);
    await user.click(trigger);
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "blob:preview-1");
    await user.click(screen.getByTestId("lightbox-backdrop"));

    // Upload flow: replace → POST → persisted URL takes over.
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    objectUrls.restore();
  });
});
