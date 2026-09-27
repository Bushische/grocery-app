import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkUploadsWritable,
  probeUploadsWritable,
  uploadsNotWritableMessage,
} from "./uploads-probe";

// chmod cannot stop root from writing (DAC bypass), so the read-only cases are
// only meaningful for a non-root test process.
const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

const tempDirs: string[] = [];

function makeUploadsDir(mode?: number): string {
  const dir = mkdtempSync(join(tmpdir(), "grocery-probe-"));
  tempDirs.push(dir);
  if (mode !== undefined) {
    chmodSync(dir, mode);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true });
    } catch {
      // best effort
    }
  }
});

type LogEntry = { level: "warn" | "error"; message: string };

function recordingLog(): {
  entries: LogEntry[];
  log: { warn: (m: string) => void; error: (m: string) => void };
} {
  const entries: LogEntry[] = [];
  return {
    entries,
    log: {
      warn: (message) => entries.push({ level: "warn", message }),
      error: (message) => entries.push({ level: "error", message }),
    },
  };
}

describe("probeUploadsWritable", () => {
  it("reports a writable dir as ok and leaves no probe file behind", () => {
    const dir = makeUploadsDir(0o700);
    expect(probeUploadsWritable(dir)).toEqual({ ok: true });
    expect(readdirSync(dir)).toEqual([]);
  });

  it.runIf(!runningAsRoot)("reports a read-only dir as not writable with the EACCES error", () => {
    const dir = makeUploadsDir(0o500);
    const result = probeUploadsWritable(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EACCES");
    }
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("uploadsNotWritableMessage", () => {
  it("names the path, error code, uid and the chown/bind-mount fix (T38)", () => {
    const message = uploadsNotWritableMessage("/data/images", {
      ...new Error("permission denied"),
      code: "EACCES",
    });
    expect(message).toContain("/data/images");
    expect(message).toContain("EACCES");
    expect(message).toContain(
      `uid ${typeof process.getuid === "function" ? process.getuid() : "unknown"}`,
    );
    expect(message).toContain("chown -R 100:101 /data/images");
    expect(message).toContain("bind-mount");
  });
});

describe("checkUploadsWritable", () => {
  it("stays silent for a writable dir", () => {
    const dir = makeUploadsDir(0o700);
    const { entries, log } = recordingLog();
    expect(() => checkUploadsWritable(dir, { isProduction: true, log })).not.toThrow();
    expect(entries).toEqual([]);
  });

  it.runIf(!runningAsRoot)("logs a loud warning and continues outside production", () => {
    const dir = makeUploadsDir(0o500);
    const { entries, log } = recordingLog();
    expect(() => checkUploadsWritable(dir, { isProduction: false, log })).not.toThrow();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.level).toBe("warn");
    expect(entry?.message).toContain(dir);
    expect(entry?.message).toContain("chown -R 100:101");
  });

  it.runIf(!runningAsRoot)("logs an explicit error and throws in production", () => {
    const dir = makeUploadsDir(0o500);
    const { entries, log } = recordingLog();
    expect(() => checkUploadsWritable(dir, { isProduction: true, log })).toThrow(
      /not writable[\s\S]*chown -R 100:101/,
    );
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.level).toBe("error");
    expect(entry?.message).toContain(dir);
  });
});
