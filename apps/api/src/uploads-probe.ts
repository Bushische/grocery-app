import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type UploadsProbe = { ok: true } | { ok: false; error: NodeJS.ErrnoException };

/** Minimal structural view of the Fastify/pino logger used at boot. */
type BootLogger = {
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * Create+delete a temp file in `uploadsRoot` as the runtime user (T38). A
 * root-owned (or read-only) volume otherwise only surfaces as an opaque 500
 * (`EACCES ... writeFileSync`) when the first user tries to upload.
 */
export function probeUploadsWritable(uploadsRoot: string): UploadsProbe {
  const probeFile = join(uploadsRoot, `.grocery-write-probe-${randomUUID()}`);
  try {
    writeFileSync(probeFile, "");
    unlinkSync(probeFile);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error as NodeJS.ErrnoException };
  }
}

/** Actionable failure message per T38: names the path, uid, and the fix. */
export function uploadsNotWritableMessage(
  uploadsRoot: string,
  error: NodeJS.ErrnoException,
): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
  const code = error.code ?? "UNKNOWN";
  return (
    `Uploads directory is not writable by this process: ${uploadsRoot} ` +
    `(${code} as uid ${uid}). Image uploads would fail with 500. ` +
    `Fix: chown -R 100:101 ${uploadsRoot} (the container app user) or bind-mount the uploads volume writable.`
  );
}

/**
 * Boot-time writability self-check (T38): on failure, production exits
 * non-zero with the actionable message; in dev a loud warning is logged and
 * the server continues so a laptop dev environment is not bricked by perms.
 */
export function checkUploadsWritable(
  uploadsRoot: string,
  options: { isProduction: boolean; log: BootLogger },
): void {
  const probe = probeUploadsWritable(uploadsRoot);
  if (probe.ok) {
    return;
  }
  const message = uploadsNotWritableMessage(uploadsRoot, probe.error);
  if (options.isProduction) {
    options.log.error(message);
    throw new Error(message);
  }
  options.log.warn(message);
}
