import { IMAGE_UPLOAD_WEBP_QUALITY, MAX_IMAGE_UPLOAD_LONG_EDGE } from "@grocery/shared";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubImagePipeline } from "../../../test/image-stub";
import { resizeImage } from "./resize-image";
import "../../../test/setup";

describe("resizeImage (T18 client-side downscale before POST /items/:id/image)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scales a 2400×1800 phone photo down to the 1200 px long edge and encodes webp", async () => {
    const stub = stubImagePipeline({ width: 2400, height: 1800 });

    const blob = await resizeImage(new Blob(["jpeg-bytes"], { type: "image/jpeg" }));

    expect(stub.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(stub.drawImageCalls[0]).toMatchObject({ dx: 0, dy: 0, width: 1200, height: 900 });
    expect(stub.toBlobCalls[0]?.type).toBe("image/webp");
    expect(stub.toBlobCalls[0]?.quality).toBe(IMAGE_UPLOAD_WEBP_QUALITY);
    expect(blob).toBeDefined();
    expect(blob.type).toBe("image/webp");
    expect(stub.bitmap.closed).toBe(true);
    expect(MAX_IMAGE_UPLOAD_LONG_EDGE).toBe(1200);
  });

  it("never upscales — an 800×600 image keeps its size", async () => {
    const stub = stubImagePipeline({ width: 800, height: 600 });

    await resizeImage(new Blob(["jpeg-bytes"], { type: "image/jpeg" }));

    expect(stub.drawImageCalls[0]).toMatchObject({ dx: 0, dy: 0, width: 800, height: 600 });
  });

  it("rejects when the canvas 2D context is unavailable", async () => {
    stubImagePipeline({ width: 2400, height: 1800 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    await expect(resizeImage(new Blob(["jpeg-bytes"], { type: "image/jpeg" }))).rejects.toThrow(
      /Canvas is unavailable/,
    );
  });
});
