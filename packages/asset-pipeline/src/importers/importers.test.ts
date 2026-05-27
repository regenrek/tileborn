import { TileSet, hashBytes } from "@tileborne/core";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { audioImporter } from "./audio-importer.js";
import { imageImporter } from "./image-importer.js";
import { tilesetImporter } from "./tileset-importer.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]);
const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

describe("image importer", () => {
  it("produces an image Asset with a core content hash", () => {
    const result = imageImporter.import({
      filename: "terrain.png",
      mime: "image/png",
      bytes: png,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toHaveLength(1);
      expect(result.success[0]?.kind).toBe("image");
      expect(result.success[0]?.properties.hash).toBe(hashBytes(png));
    }
  });

  it("rejects unsupported image inputs", () => {
    const result = imageImporter.import({
      filename: "sound.ogg",
      mime: "audio/ogg",
      bytes: ogg,
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("tileset importer", () => {
  it("splits a 64x64 image into a deterministic 16-tile grid", () => {
    const first = tilesetImporter.import({
      filename: "terrain.png",
      mime: "image/png",
      bytes: png,
      name: "Terrain",
      imageWidth: 64,
      imageHeight: 64,
      tileWidth: 16,
      tileHeight: 16,
      columns: 4,
      rows: 4,
    });
    const second = tilesetImporter.import({
      filename: "terrain.png",
      mime: "image/png",
      bytes: png,
      name: "Terrain",
      imageWidth: 64,
      imageHeight: 64,
      tileWidth: 16,
      tileHeight: 16,
      columns: 4,
      rows: 4,
    });

    expect(Result.isSuccess(first)).toBe(true);
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isSuccess(first) && Result.isSuccess(second)) {
      const tileSet = first.success.find((asset) => asset instanceof TileSet);
      const tileSetAgain = second.success.find((asset) => asset instanceof TileSet);
      expect(tileSet).toBeInstanceOf(TileSet);
      expect(tileSet?.tileCount).toBe(16);
      expect(tileSet?.tiles).toHaveLength(16);
      expect(tileSet?.tiles[0]?.id).toBe(tileSetAgain instanceof TileSet ? tileSetAgain.tiles[0]?.id : "");
    }
  });

  it("rejects a grid that does not cover the image exactly", () => {
    const result = tilesetImporter.import({
      filename: "terrain.png",
      mime: "image/png",
      bytes: png,
      name: "Terrain",
      imageWidth: 64,
      imageHeight: 64,
      tileWidth: 16,
      tileHeight: 16,
      columns: 3,
      rows: 4,
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("audio importer", () => {
  it("accepts tiny canned OGG and WAV signatures", () => {
    const oggResult = audioImporter.import({
      filename: "theme.ogg",
      mime: "audio/ogg",
      bytes: ogg,
    });
    const wavResult = audioImporter.import({
      filename: "hit.wav",
      mime: "audio/wav",
      bytes: wav,
    });

    expect(Result.isSuccess(oggResult)).toBe(true);
    expect(Result.isSuccess(wavResult)).toBe(true);
    if (Result.isSuccess(oggResult) && Result.isSuccess(wavResult)) {
      expect(oggResult.success[0]?.kind).toBe("audio");
      expect(wavResult.success[0]?.properties.hash).toBe(hashBytes(wav));
    }
  });
});
