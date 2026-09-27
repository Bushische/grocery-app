import { IMAGE_UPLOAD_WEBP_QUALITY, MAX_IMAGE_UPLOAD_LONG_EDGE } from "@grocery/shared";

/**
 * Client-side downscale before POST /items/:id/image (docs/TASKS.md → T18):
 * `createImageBitmap` decodes the photo, a canvas resamples it to at most
 * `MAX_IMAGE_UPLOAD_LONG_EDGE` (1200 px) on the long edge (never upscaled),
 * and `canvas.toBlob` encodes WebP at `IMAGE_UPLOAD_WEBP_QUALITY` — phone
 * photos (~12 MB) drop to well under ~500 KB on the wire. The server-side
 * `sharp` resize (T10, 600 px) remains the safety net.
 */
export async function resizeImage(
  file: Blob,
  maxLongEdge: number = MAX_IMAGE_UPLOAD_LONG_EDGE,
  quality: number = IMAGE_UPLOAD_WEBP_QUALITY,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas is unavailable — cannot resize the image.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      "image/webp",
      quality,
    );
  });
}
