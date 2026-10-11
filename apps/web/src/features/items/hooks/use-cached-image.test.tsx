// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import {
  clearImageMemoryCache,
  createMemoryImageCacheBackend,
  setImageCacheBackend,
  warmImageCache,
} from "../lib/image-cache";
import { useCachedImageSrc } from "./use-cached-image";

const BLOB = new Blob(["photo-bytes"], { type: "image/webp" });
const NOW = 1_700_000_000_000;

function Probe({ filename }: { filename: string | null }) {
  const src = useCachedImageSrc(filename);
  return src ? <img data-testid="probe-image" src={src} alt="" /> : <p>No photo</p>;
}

beforeEach(() => {
  clearImageMemoryCache();
  setImageCacheBackend(createMemoryImageCacheBackend());
  vi.restoreAllMocks();
});

describe("useCachedImageSrc (T95)", () => {
  it("renders /static immediately on a cold cache and upgrades once warmed", async () => {
    URL.createObjectURL = vi.fn(() => "blob:warmed-1") as typeof URL.createObjectURL;
    globalThis.fetch = vi.fn(
      async () => new Response(BLOB, { status: 200 }),
    ) as unknown as typeof fetch;

    render(<Probe filename="i1-abc.webp" />);

    // First paint never waits for the cache: the browser HTTP cache serves it.
    expect(screen.getByTestId("probe-image")).toHaveAttribute("src", "/static/i1-abc.webp");

    await waitFor(() =>
      expect(screen.getByTestId("probe-image")).toHaveAttribute("src", "blob:warmed-1"),
    );
  });

  it("serves the cached object URL on first paint with zero fetches", async () => {
    const backend = createMemoryImageCacheBackend({
      "i1-abc.webp": { blob: BLOB, fetchedAt: NOW },
    });
    setImageCacheBackend(backend);
    const fetchFn = vi.fn(async () => new Response(BLOB, { status: 200 }));
    await warmImageCache("i1-abc.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:cached-1",
    });
    const networkFetch = vi.fn(async () => new Response(BLOB, { status: 200 }));
    globalThis.fetch = networkFetch as unknown as typeof fetch;

    render(<Probe filename="i1-abc.webp" />);

    expect(screen.getByTestId("probe-image")).toHaveAttribute("src", "blob:cached-1");
    expect(networkFetch).not.toHaveBeenCalled();
    // The store entry was fresh, so even the warming call issued no request.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("renders the placeholder for a null filename without fetching", () => {
    const networkFetch = vi.fn();
    globalThis.fetch = networkFetch as unknown as typeof fetch;

    render(<Probe filename={null} />);

    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
