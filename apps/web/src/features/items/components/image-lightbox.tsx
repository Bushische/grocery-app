import { useEffect, useRef } from "react";

export interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * Full-screen photo view (docs/TASKS.md → T46): dimmed backdrop, the image
 * centered at maximum width/height fit. Closes on backdrop tap, ✕ button
 * (≥ 40 px target), and Escape; focus returns to the preview on close
 * (handled by the caller via `onClose`).
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" data-testid="image-lightbox">
      <button
        type="button"
        aria-label="Close photo view"
        data-testid="lightbox-backdrop"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80"
      />
      {/* The dialog layer never covers the backdrop hit area — taps on the dimmed
          area reach the close button above; only the photo swallows clicks. */}
      <div
        ref={dialogRef}
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings UA styles (max-width, inset) that fight the full-screen layout
        role="dialog"
        aria-modal="true"
        aria-label="Item photo, full size"
        tabIndex={-1}
        data-testid="lightbox-dialog"
        className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 focus:outline-none"
      >
        <img
          src={src}
          alt={alt}
          data-testid="lightbox-image"
          className="pointer-events-auto max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
      </div>
      <button
        type="button"
        aria-label="Close photo view"
        data-testid="lightbox-close"
        onClick={onClose}
        className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          ✕
        </span>
      </button>
    </div>
  );
}
