import { useCallback, useEffect, useRef, useState } from "react";
import { resizeImage } from "../lib/resize-image";

const PICK_ERROR = "Could not read the photo. Please try another file.";

export interface ImageUploadProps {
  imageFilename: string | null;
  itemTitle: string;
  pending: boolean;
  error: string | null;
  /** Resolves after the server accepted the photo (rejected = surfaced via error). */
  onUpload: (image: Blob, filename: string) => Promise<unknown>;
}

interface SelectedImage {
  blob: Blob;
  filename: string;
  previewUrl: string;
}

interface LightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * Full-screen photo view (docs/TASKS.md → T46): dimmed backdrop, the image
 * centered at maximum width/height fit. Closes on backdrop tap, ✕ button
 * (≥ 40 px target), and Escape; focus returns to the preview on close.
 */
function Lightbox({ src, alt, onClose }: LightboxProps) {
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

/**
 * Image upload + preview (docs/TASKS.md → T18, preview enlarged by T46). The
 * picked photo is downscaled client-side (`resizeImage`), previewed from an
 * object URL, and uploaded via the mutation — the server stores it
 * content-addressed under /static (T10), so the refreshed item's
 * `imageFilename` is the new URL. The stored photo and the pre-upload preview
 * render full card width and open the T46 full-screen lightbox on tap; the
 * upload/replace controls stay below the large preview.
 */
export function ImageUpload({
  imageFilename,
  itemTitle,
  pending,
  error,
  onUpload,
}: ImageUploadProps) {
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Revoke the preview URL when it is replaced or on unmount.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    // Restore focus to the preview — the overlay that held focus is unmounting.
    previewTriggerRef.current?.focus();
  }, []);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPickError(null);
    try {
      const blob = await resizeImage(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const previewUrl = URL.createObjectURL(blob);
      objectUrlRef.current = previewUrl;
      setSelected({ blob, filename: file.name, previewUrl });
    } catch {
      setPickError(PICK_ERROR);
      setSelected(null);
    }
  }

  function upload() {
    if (!selected) return;
    setPickError(null);
    // On success drop the local preview — the refreshed item's content-addressed
    // imageFilename takes over, showing the persisted round-trip.
    void Promise.resolve(onUpload(selected.blob, selected.filename))
      .then(() => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        setSelected(null);
      })
      .catch(() => {
        // The page surfaces the upload error; keep the preview for a retry.
      });
  }

  const previewSrc = selected
    ? selected.previewUrl
    : imageFilename
      ? `/static/${imageFilename}`
      : null;

  return (
    <section aria-label="Item photo" className="space-y-3">
      {previewSrc ? (
        <button
          ref={previewTriggerRef}
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block w-full overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          <img
            src={previewSrc}
            alt={selected ? `${itemTitle} — newly chosen preview` : `${itemTitle} (stored)`}
            data-testid={selected ? "item-image-preview" : "item-image"}
            className="h-52 w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex h-52 w-full items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400 ring-1 ring-gray-200">
          No photo
        </div>
      )}
      <div className="space-y-2">
        <label
          htmlFor="item-image-input"
          className="block min-h-11 cursor-pointer rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100"
        >
          {selected ? "Choose another photo" : "Choose photo"}
        </label>
        <input
          id="item-image-input"
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="sr-only"
        />
        <button
          type="button"
          onClick={upload}
          disabled={!selected || pending}
          className="block min-h-11 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Upload photo"}
        </button>
      </div>
      {pickError ? (
        <p role="alert" className="text-sm text-red-600">
          {pickError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {lightboxOpen && previewSrc ? (
        <Lightbox
          src={previewSrc}
          alt={selected ? `${itemTitle} — newly chosen preview` : `${itemTitle} (stored)`}
          onClose={closeLightbox}
        />
      ) : null}
    </section>
  );
}
