import { useEffect, useRef, useState } from "react";
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

/**
 * Image upload + preview (docs/TASKS.md → T18). The picked photo is downscaled
 * client-side (`resizeImage`), previewed from an object URL, and uploaded via
 * the mutation — the server stores it content-addressed under /static (T10),
 * so the refreshed item's `imageFilename` is the new URL.
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
  const objectUrlRef = useRef<string | null>(null);

  // Revoke the preview URL when it is replaced or on unmount.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

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

  return (
    <section aria-label="Item photo" className="space-y-3">
      <div className="flex items-center gap-3">
        {selected ? (
          <img
            src={selected.previewUrl}
            alt={`${itemTitle} — newly chosen preview`}
            className="h-24 w-24 rounded-lg object-cover ring-1 ring-gray-200"
          />
        ) : imageFilename ? (
          <img
            src={`/static/${imageFilename}`}
            alt={`${itemTitle} (stored)`}
            data-testid="item-image"
            className="h-24 w-24 rounded-lg object-cover ring-1 ring-gray-200"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400 ring-1 ring-gray-200">
            No photo
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
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
    </section>
  );
}
