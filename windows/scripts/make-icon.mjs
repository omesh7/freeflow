// Generates tiny tray/app PNGs with the Node standard library only
// (node:fs + node:zlib). Run once: `node scripts/make-icon.mjs`.
// Overwrites windows/src-tauri/icons/*.png (binary, committed).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const TABLE = crc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 8 + data.length);
  return out;
}

// Dark rounded square with a white waveform. Deterministic pattern.
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const bars = [0.35, 0.6, 0.9, 0.55, 0.75, 0.4, 0.65, 0.5];
  const n = bars.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const col = Math.floor((x / size) * n);
      const half = (bars[col] * size) / 2;
      const mid = size / 2;
      const inBar = Math.abs(y - mid) < half && x % Math.max(1, Math.floor(size / (n * 3))) < Math.max(1, Math.floor(size / (n * 6)));
      // Slate background, white bars.
      px[i] = inBar ? 255 : 31;
      px[i + 1] = inBar ? 255 : 41;
      px[i + 2] = inBar ? 255 : 55;
      px[i + 3] = 255;
    }
  }
  return px;
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pixels = draw(size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size] of [["tray-32.png", 32], ["app-128.png", 128]]) {
  writeFileSync(join(outDir, name), png(size));
  console.log(`wrote ${name} (${size}x${size})`);
}

// Windows .ico with PNG-compressed entries (Vista+). tauri-build requires
// icons/icon.ico for the exe resource file even when bundling is off.
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dirs = [];
  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0; // palette
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bit depth
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    offset += data.length;
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.data)]);
}

const iconEntries = [32, 128].map((size) => ({ size, data: png(size) }));
writeFileSync(join(outDir, "icon.ico"), ico(iconEntries));
console.log(`wrote icon.ico (${iconEntries.length} entries)`);

// Raw RGBA for the Rust tray icon (no PNG decoder needed in the binary).
writeFileSync(join(outDir, "tray-32.rgba"), draw(32));
console.log("wrote tray-32.rgba (32x32 raw)");
