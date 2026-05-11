/**
 * Generates Fitcheck extension icons (16, 32, 48, 128 px PNG).
 * Uses only Node.js built-ins — no external dependencies.
 *
 * Run: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dir, "..", "icons");

// ── CRC-32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG builder ──────────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

/** Encode raw RGBA Uint8Array to PNG bytes. */
function encodePng(width, height, pixels) {
  const rowLen = width * 4;
  // PNG filter byte (0 = None) prepended to each row
  const raw = new Uint8Array(height * (rowLen + 1));
  for (let y = 0; y < height; y++) {
    const dest = y * (rowLen + 1);
    raw[dest] = 0;
    raw.set(pixels.subarray(y * rowLen, (y + 1) * rowLen), dest + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from(raw))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Icon drawing ─────────────────────────────────────────────────────────────

const BG = [23, 32, 26, 255];    // #17201a  dark green-black
const FG = [168, 213, 162, 255]; // #a8d5a2  light sage green

/** Draw a pixel (with anti-alias alpha blending based on distance from edge). */
function blend(pixels, size, x, y, color, alpha = 1) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= size || yi < 0 || yi >= size) return;
  const i = (yi * size + xi) * 4;
  const a = alpha;
  const ia = 1 - a;
  pixels[i]     = Math.round(color[0] * a + pixels[i]     * ia);
  pixels[i + 1] = Math.round(color[1] * a + pixels[i + 1] * ia);
  pixels[i + 2] = Math.round(color[2] * a + pixels[i + 2] * ia);
  pixels[i + 3] = Math.round(color[3] * a + pixels[i + 3] * ia);
}

function drawThickLine(pixels, size, x0, y0, x1, y1, thickness) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const r = Math.ceil(thickness);
    for (let px = -r; px <= r; px++) {
      for (let py = -r; py <= r; py++) {
        const dist = Math.sqrt(px * px + py * py);
        if (dist <= thickness) {
          const alpha = dist <= thickness - 0.5 ? 1 : thickness + 0.5 - dist;
          blend(pixels, size, cx + px, cy + py, FG, Math.min(1, alpha));
        }
      }
    }
  }
}

function drawRoundedRect(pixels, size, rx, ry, rw, rh, radius) {
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      // Distance to nearest corner arc center
      const cx = x < rx + radius ? rx + radius : x > rx + rw - radius ? rx + rw - radius : x;
      const cy = y < ry + radius ? ry + radius : y > ry + rh - radius ? ry + rh - radius : y;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        blend(pixels, size, x, y, BG, 1);
      }
    }
  }
}

function drawFitcheckIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  // Transparent background
  pixels.fill(0);

  // Rounded rectangle background
  const pad = size < 24 ? 0 : Math.round(size * 0.04);
  const radius = Math.round(size * (size <= 16 ? 0.2 : 0.22));
  drawRoundedRect(pixels, size, pad, pad, size - pad * 2, size - pad * 2, radius);

  // Checkmark: knee at ~(28%, 68%), bottom at ~(44%, 82%), top-right at ~(82%, 22%)
  const s = size;
  const knee = [0.26 * s, 0.68 * s];
  const bottom = [0.44 * s, 0.82 * s];
  const tip = [0.80 * s, 0.24 * s];
  const thickness = Math.max(1.2, s / (s <= 16 ? 6.5 : 8));

  drawThickLine(pixels, size, knee[0], knee[1], bottom[0], bottom[1], thickness);
  drawThickLine(pixels, size, bottom[0], bottom[1], tip[0], tip[1], thickness);

  return pixels;
}

// ── Generate files ───────────────────────────────────────────────────────────

mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const pixels = drawFitcheckIcon(size);
  const png = encodePng(size, size, pixels);
  const outPath = join(iconsDir, `icon${size}.png`);
  writeFileSync(outPath, png);
  console.log(`  icons/icon${size}.png  (${png.length} bytes)`);
}

console.log("Done.");
