/** Offline only: editable SVG -> transparent PNG frames. No runtime rasterizer.
 * Generated visual assets include Apache-2.0 Fairy-DSH adaptations; see ../NOTICE.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { frameSvg, manifest } from "./frame-svg.mjs";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("assets/fairy.svg", root), "utf8");
for (const appearance of manifest.variants) {
  const directory = new URL(`assets/frames/${appearance}/`, root);
  mkdirSync(directory, { recursive: true });
  for (let frame = 0; frame < manifest.count; frame++) {
    const svg = frameSvg(source, frame * manifest.intervalMs, appearance);
    writeFileSync(new URL(`${String(frame).padStart(3, "0")}.png`, directory), new Resvg(svg).render().asPng());
  }
}
writeFileSync(new URL("assets/frames/manifest.json", root), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${2 * manifest.count} transparent frames in ${fileURLToPath(new URL("assets/frames/", root))}`);
