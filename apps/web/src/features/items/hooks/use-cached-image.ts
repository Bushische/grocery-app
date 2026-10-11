import { useEffect, useState } from "react";
import { getMemoryImageUrl, imageNetworkUrl, warmImageCache } from "../lib/image-cache";

/**
 * Locally cached photo URL (T95).
 *
 * Returns the in-memory object URL when the photo is already cached, else the
 * `/static/…` network URL for an instant first paint while the IndexedDB
 * cache warms in the background — the component re-renders with the object
 * URL once it resolves, and repeat views within 7 days issue no request.
 * Null filename → null (the "No photo" placeholder path).
 */
export function useCachedImageSrc(imageFilename: string | null): string | null {
  const [cachedUrl, setCachedUrl] = useState<string | null>(() =>
    imageFilename ? getMemoryImageUrl(imageFilename) : null,
  );

  useEffect(() => {
    if (!imageFilename) {
      setCachedUrl(null);
      return;
    }
    const memorized = getMemoryImageUrl(imageFilename);
    if (memorized) {
      setCachedUrl(memorized);
      return;
    }
    let cancelled = false;
    void warmImageCache(imageFilename).then((url) => {
      if (!cancelled && url) setCachedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [imageFilename]);

  if (!imageFilename) return null;
  return cachedUrl ?? imageNetworkUrl(imageFilename);
}
