import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "vendor/basic-pitch");
const checking = process.argv.includes("--check");
const output = checking
  ? await fs.mkdtemp(path.join(os.tmpdir(), "partitura-viva-basic-pitch-"))
  : destination;
const packageRoot = path.join(root, "node_modules/@spotify/basic-pitch");

async function copy(relativeSource, relativeDestination = relativeSource) {
  const target = path.join(output, relativeDestination);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(packageRoot, relativeSource), target);
}

try {
  await fs.mkdir(output, { recursive: true });
  await build({
    entryPoints: [path.join(root, "scripts/basic-pitch-runtime-entry.js")],
    outfile: path.join(output, "basic-pitch-runtime.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome100", "safari15"],
    minify: true,
    legalComments: "eof",
  });
  await copy("model/model.json");
  await copy("model/group1-shard1of1.bin");
  await copy("LICENSE", "LICENSE.spotify-basic-pitch");

  if (checking) {
    for (const relative of [
      "basic-pitch-runtime.js",
      "model/model.json",
      "model/group1-shard1of1.bin",
      "LICENSE.spotify-basic-pitch",
    ]) {
      const [generated, committed] = await Promise.all([
        fs.readFile(path.join(output, relative)),
        fs.readFile(path.join(destination, relative)),
      ]);
      assert.deepEqual(
        generated,
        committed,
        `${relative} está desatualizado; execute npm run build:neural`,
      );
    }
  }
} finally {
  if (checking) await fs.rm(output, { recursive: true, force: true });
}
