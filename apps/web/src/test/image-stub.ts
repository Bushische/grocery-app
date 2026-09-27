import { IMAGE_UPLOAD_WEBP_QUALITY } from "@grocery/shared";
import { vi } from "vitest";

export const STUB_OUTPUT_BLOB = new Blob(["webp-bytes"], { type: "image/webp" });

export interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

export interface DrawImageCall {
  image: FakeBitmap;
  dx: number;
  dy: number;
  width: number;
  height: number;
}

export interface StubbedImagePipeline {
  bitmap: FakeBitmap;
  createImageBitmap: ReturnType<typeof vi.fn>;
  drawImageCalls: DrawImageCall[];
  toBlobCalls: { type: string | null; quality: unknown }[];
}

/**
 * jsdom has no image decoder or canvas rasterizer, so tests stub the two
 * browser primitives the client-side downscale uses: `createImageBitmap`
 * (decode) and the canvas 2D context + `toBlob` (resample + encode).
 */
export function stubImagePipeline(source: { width: number; height: number }): StubbedImagePipeline {
  const bitmap: FakeBitmap = {
    width: source.width,
    height: source.height,
    closed: false,
    close() {
      bitmap.closed = true;
    },
  };
  const createImageBitmap = vi.fn(async () => {
    bitmap.closed = false;
    return bitmap;
  });
  const drawImageCalls: DrawImageCall[] = [];
  const toBlobCalls: { type: string | null; quality: unknown }[] = [];

  vi.stubGlobal(
    "createImageBitmap",
    createImageBitmap as unknown as typeof globalThis.createImageBitmap,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    return {
      drawImage: (...args: unknown[]) => {
        drawImageCalls.push({
          image: args[0] as FakeBitmap,
          dx: args[1] as number,
          dy: args[2] as number,
          width: args[3] as number,
          height: args[4] as number,
        });
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback: ((blob: Blob | null) => void) | null, type?: string | null, quality?: unknown) => {
      toBlobCalls.push({ type: type ?? null, quality });
      callback?.(STUB_OUTPUT_BLOB);
    },
  );

  return { bitmap, createImageBitmap, drawImageCalls, toBlobCalls };
}

/** jsdom cannot create object URLs — deterministic stubs for preview handling. */
export function stubObjectUrls(): { previewUrl: string; restore: () => void } {
  const previewUrl = "blob:preview-1";
  const originalCreateObjectURL = URL.createObjectURL as unknown;
  const originalRevokeObjectURL = URL.revokeObjectURL as unknown;
  URL.createObjectURL = vi.fn(() => previewUrl) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  return {
    previewUrl,
    restore: () => {
      URL.createObjectURL = originalCreateObjectURL as typeof URL.createObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL as typeof URL.revokeObjectURL;
    },
  };
}

export const EXPECTED_WEBP_QUALITY = IMAGE_UPLOAD_WEBP_QUALITY;
