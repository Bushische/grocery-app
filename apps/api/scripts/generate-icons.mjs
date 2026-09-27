import fs from "node:fs";
// T24.5 authoring tool: renders the PWA icons into apps/web/public/ from the
// inline SVG sources below. Lives in apps/api only because sharp is an api
// dependency; the web image build never runs it (icons are committed).
//
// Run once after changing the sources:  pnpm --filter api exec node scripts/generate-icons.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(apiDir, "../../web/public");
fs.mkdirSync(outDir, { recursive: true });

// Brand colors (must match the manifest in apps/web/src/lib/pwa-config.ts).
const GREEN = "#16a34a";
const DARK = "#052e16";

/**
 * White shopping basket on a green field. viewBox 0 0 512 512.
 * Basket: trapezoid body, rim bar, handle arc, four slanted slats.
 */
function basketGlyph({ scale = 1, dx = 0, dy = 0 } = {}) {
  // Geometry designed in a 512 box, scaled/translated for the maskable safe zone.
  const body = `<path d="M96 208h320l-34 170a36 36 0 0 1-35 29H165a36 36 0 0 1-35-29l-34-170Z" fill="#fff"/>`;
  const rim = `<rect x="72" y="184" width="368" height="40" rx="20" fill="#fff"/>`;
  const handle = `<path d="M256 176c-56 0-102-32-102-84h44c0 28 24 44 58 44s58-16 58-44h44c0 52-46 84-102 84Z" fill="#fff"/>`;
  const slats = `<g fill="${GREEN}">
      <rect x="196" y="236" width="18" height="138" rx="9" transform="rotate(-8 205 305)"/>
      <rect x="247" y="236" width="18" height="138" rx="9"/>
      <rect x="298" y="236" width="18" height="138" rx="9" transform="rotate(8 307 305)"/>
    </g>`;
  return `<g transform="translate(${dx} ${dy}) scale(${scale})">${handle}${body}${rim}${slats}</g>`;
}

// Full-bleed square background + centered glyph (any purpose, corners get
// rounded by launchers that want it).
const anySvg = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${GREEN}"/>
    ${basketGlyph()}
  </svg>`;

// Maskable: the glyph must sit inside the 80% safe zone
// (512 × 0.4 = 205px radius circle); scale the art down and keep the
// background full-bleed so any mask shape works.
const maskableSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${GREEN}"/>
    ${basketGlyph({ scale: 0.62, dx: 97, dy: 97 })}
  </svg>`;

// Favicon/apple touch: green glyph on white so it reads on light tab strips.
const lightSvg = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="96" fill="#fff"/>
    <rect width="512" height="512" rx="96" fill="${GREEN}" fill-opacity="0.08"/>
    <g fill="${DARK}">
      <path d="M96 208h320l-34 170a36 36 0 0 1-35 29H165a36 36 0 0 1-35-29l-34-170Z"/>
      <rect x="72" y="184" width="368" height="40" rx="20"/>
      <path d="M256 176c-56 0-102-32-102-84h44c0 28 24 44 58 44s58-16 58-44h44c0 52-46 84-102 84Z"/>
    </g>
    <g fill="${GREEN}">
      <rect x="196" y="236" width="18" height="138" rx="9" transform="rotate(-8 205 305)"/>
      <rect x="247" y="236" width="18" height="138" rx="9"/>
      <rect x="298" y="236" width="18" height="138" rx="9" transform="rotate(8 307 305)"/>
    </g>
  </svg>`;

const targets = [
  { name: "pwa-192x192.png", svg: anySvg(), size: 192 },
  { name: "pwa-512x512.png", svg: anySvg(), size: 512 },
  { name: "pwa-maskable-512x512.png", svg: maskableSvg, size: 512 },
  { name: "apple-touch-icon.png", svg: lightSvg(), size: 180 },
  { name: "favicon-96x96.png", svg: lightSvg(), size: 96 },
];

for (const { name, svg, size } of targets) {
  const source = typeof svg === "function" ? svg() : svg;
  const out = path.join(outDir, name);
  await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log(`wrote ${out}`);
}
