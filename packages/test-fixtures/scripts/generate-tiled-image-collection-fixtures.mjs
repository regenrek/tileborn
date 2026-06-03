// Procedurally generates the synthetic PNG fixtures used by the
// tiled-image-collection import tests. The output is 100% generated here
// (no third-party art): a flat grid tile and a simple shape sprite.
//
// Run with: node packages/test-fixtures/scripts/generate-tiled-image-collection-fixtures.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "fixtures", "maps", "tiled-image-collection");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
};

// rgba: (x, y) => [r, g, b, a]
const encodePng = (width, height, rgba) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = rgba(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// terrain.png: flat 32x32 grid tile (matches the TMJ-declared tile size).
const terrain = encodePng(32, 32, (x, y) => {
  const onGrid = x === 0 || y === 0 || x === 31 || y === 31;
  return onGrid ? [60, 90, 60, 255] : [96, 160, 96, 255];
});

// tree.png: simple synthetic sprite (64x96) with transparency.
const tree = encodePng(64, 96, (x, y) => {
  const cx = 32;
  const trunkTop = 64;
  const inTrunk = y >= trunkTop && Math.abs(x - cx) <= 6;
  if (inTrunk) {
    return [120, 80, 48, 255];
  }
  const canopyR = 28;
  const dx = x - cx;
  const dy = y - 36;
  if (dx * dx + dy * dy <= canopyR * canopyR) {
    return [72, 140, 72, 255];
  }
  return [0, 0, 0, 0];
});

writeFileSync(path.join(outDir, "terrain.png"), terrain);
writeFileSync(path.join(outDir, "tree.png"), tree);
console.log("wrote synthetic terrain.png (32x32) and tree.png (64x96)");
