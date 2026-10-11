import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_CACHE_TTL_MS,
  clearImageMemoryCache,
  createMemoryImageCacheBackend,
  imageNetworkUrl,
  isImageCacheEntryFresh,
  setImageCacheBackend,
  warmImageCache,
} from "./image-cache";

const BLOB = new Blob(["photo-bytes"], { type: "image/webp" });
const NOW = 1_700_000_000_000;

beforeEach(() => {
  clearImageMemoryCache();
  setImageCacheBackend(null);
});

describe("image-cache (T95)", () => {
  it("keeps cached photos for at least 7 days", () => {
    expect(IMAGE_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isImageCacheEntryFresh({ blob: BLOB, fetchedAt: NOW }, NOW)).toBe(true);
    expect(isImageCacheEntryFresh({ blob: BLOB, fetchedAt: NOW - IMAGE_CACHE_TTL_MS }, NOW)).toBe(
      true,
    );
    expect(
      isImageCacheEntryFresh({ blob: BLOB, fetchedAt: NOW - IMAGE_CACHE_TTL_MS - 1 }, NOW),
    ).toBe(false);
    // Clock skew (stored "in the future") is treated as stale, never trusted.
    expect(isImageCacheEntryFresh({ blob: BLOB, fetchedAt: NOW + 1000 }, NOW)).toBe(false);
  });

  it("serves the network URL shape the api and nginx already cache", () => {
    expect(imageNetworkUrl("i1-abc.webp")).toBe("/static/i1-abc.webp");
  });

  it("serves a fresh store entry with zero network requests", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    const createObjectUrl = vi.fn(() => "blob:cached-1");
    const backend = createMemoryImageCacheBackend({
      "i1-abc.webp": { blob: BLOB, fetchedAt: NOW },
    });
    setImageCacheBackend(backend);

    const url = await warmImageCache("i1-abc.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl,
    });

    expect(url).toBe("blob:cached-1");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalledWith(BLOB);
  });

  it("reuses the same object URL within the session without touching the store", async () => {
    const backend = createMemoryImageCacheBackend({
      "i1-abc.webp": { blob: BLOB, fetchedAt: NOW },
    });
    const getSpy = vi.spyOn(backend, "get");
    setImageCacheBackend(backend);
    const createObjectUrl = vi.fn(() => "blob:cached-1");

    await warmImageCache("i1-abc.webp", {
      fetchFn: vi.fn() as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl,
    });
    const second = await warmImageCache("i1-abc.webp", {
      fetchFn: vi.fn() as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl,
    });

    expect(second).toBe("blob:cached-1");
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("refetches a stale entry and stores it fresh", async () => {
    const freshBlob = new Blob(["new-bytes"], { type: "image/webp" });
    const backend = createMemoryImageCacheBackend({
      "i1-abc.webp": { blob: BLOB, fetchedAt: NOW - IMAGE_CACHE_TTL_MS - 1 },
    });
    setImageCacheBackend(backend);
    const fetchFn = vi.fn(
      async () =>
        new Response(freshBlob, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );

    const url = await warmImageCache("i1-abc.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:refetched-1",
    });

    expect(fetchFn).toHaveBeenCalledWith("/static/i1-abc.webp");
    expect(url).toBe("blob:refetched-1");
    expect(backend.entries.get("i1-abc.webp")).toEqual({ blob: freshBlob, fetchedAt: NOW });
  });

  it("warms a missing entry from the network for the next view", async () => {
    const backend = createMemoryImageCacheBackend();
    setImageCacheBackend(backend);
    const fetchFn = vi.fn(
      async () => new Response(BLOB, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );

    const url = await warmImageCache("i1-new.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:warmed-1",
    });

    expect(url).toBe("blob:warmed-1");
    expect(backend.entries.get("i1-new.webp")).toEqual({ blob: BLOB, fetchedAt: NOW });
  });

  it("returns null (caller falls back to /static) when the network fails", async () => {
    setImageCacheBackend(createMemoryImageCacheBackend());
    const fetchFn = vi.fn(async () => {
      throw new TypeError("offline");
    });

    const url = await warmImageCache("i1-abc.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:unused",
    });

    expect(url).toBeNull();
  });

  it("returns null on a non-200 response and stores nothing", async () => {
    const backend = createMemoryImageCacheBackend();
    setImageCacheBackend(backend);
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 }));

    const url = await warmImageCache("i1-gone.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:unused",
    });

    expect(url).toBeNull();
    expect(backend.entries.has("i1-gone.webp")).toBe(false);
  });

  it("treats each content-addressed filename as its own key", async () => {
    const backend = createMemoryImageCacheBackend({
      "i1-oldhash.webp": { blob: BLOB, fetchedAt: NOW },
    });
    setImageCacheBackend(backend);
    const fetchFn = vi.fn(
      async (input: string | URL | Request) =>
        new Response(new Blob([`${String(input)}-bytes`]), { status: 200 }),
    );

    const url = await warmImageCache("i1-newhash.webp", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => NOW,
      createObjectUrl: () => "blob:new-1",
    });

    expect(fetchFn).toHaveBeenCalledWith("/static/i1-newhash.webp");
    expect(url).toBe("blob:new-1");
  });
});
