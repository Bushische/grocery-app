import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  sourcemap: false,
  outfile: "dist/server.js",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ["better-sqlite3", "sharp"],
  logLevel: "warning",
});
