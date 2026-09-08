/* SPDX-License-Identifier: Apache-2.0
 * Adapted from Fairy-DSH, Copyright 2026 Chengzhibense.
 * mascot-runtime.js / mascot-style.js, commit
 * d639887a386b0de6fef2e61c97dc268631854591; see ../NOTICE.
 * MODIFIED: pure offline time sampler, editable parameters, exact endpoints,
 * higher-precision Bezier inversion, periodic square rotation; no DOM/runtime.
 */
import { readFileSync } from "node:fs";

export const motion = JSON.parse(readFileSync(new URL("../assets/idle-motion.json", import.meta.url), "utf8"));
export const manifest = { version: 1, width: 256, height: 256, intervalMs: 50, count: 120, variants: ["dark", "light"] };
export const cycleMs = manifest.intervalMs * manifest.count;
const layerIds = ["sclera", "iris-outer", "iris-blue", "pupil"];

export function validateMotion(config) {
  for (const key of ["breathMs", "rotationMs"]) {
    if (!(Number.isFinite(config[key]) && config[key] > 0)) throw new Error(`Invalid ${key}`);
  }
  const whole = (n) => Math.abs(n - Math.round(n)) < 1e-9;
  if (!whole(cycleMs / config.breathMs) || !whole(4 * cycleMs / config.rotationMs)) {
    throw new Error("Motion must close at 6000ms: whole breaths and quarter-turns (square symmetry)");
  }
  if (!Array.isArray(config.bezier) || config.bezier.length !== 4 ||
      !config.bezier.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("Invalid Bezier");
  if (Object.keys(config.layers).sort().join() !== [...layerIds].sort().join()) throw new Error("Expected four eye layers");
  for (const layer of Object.values(config.layers)) {
    if (!(Number.isFinite(layer.expanded) && Number.isFinite(layer.contracted) &&
        layer.contracted > 0 && layer.contracted < layer.expanded && layer.expanded <= 1 &&
        Number.isFinite(layer.lead) && layer.lead >= 0 && layer.lead < 1)) throw new Error("Invalid eye layer");
  }
}
validateMotion(motion);

/** Invert the Bezier x coordinate, not just evaluate y at the input time. */
export function easeEyePhase(value, curve = motion.bezier) {
  const x = Math.max(0, Math.min(1, value));
  if (x === 0 || x === 1) return x;
  const cubic = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2;
    if (cubic(t, curve[0], curve[2]) < x) low = t;
    else high = t;
  }
  return cubic((low + high) / 2, curve[1], curve[3]);
}

const wrap = (value, period) => ((value % period) + period) % period;
export function sampleMotion(timeMs) {
  if (!Number.isFinite(timeMs)) throw new Error("Invalid sample time");
  const phase = wrap(timeMs, motion.breathMs) / motion.breathMs;
  const scales = {};
  for (const [id, layer] of Object.entries(motion.layers)) {
    const p = wrap(phase + layer.lead, 1);
    const progress = easeEyePhase(p <= 0.5 ? p * 2 : 2 - p * 2);
    scales[id] = layer.expanded + (layer.contracted - layer.expanded) * progress;
  }
  // Identical corners repeat every 90 degrees; no other layer rotates.
  return { angle: wrap(timeMs, motion.rotationMs / 4) * 360 / motion.rotationMs, scales };
}

function replaceAnchor(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`SVG animation anchor missing or duplicated: ${marker}`);
  return source.replace(marker, replacement);
}

export function frameSvg(source, timeMs, appearance) {
  if (!manifest.variants.includes(appearance)) throw new Error("Invalid appearance");
  const { angle, scales } = sampleMotion(timeMs);
  let svg = replaceAnchor(source, 'id="corners" transform="rotate(0 80 80)"', `id="corners" transform="rotate(${angle.toFixed(6)} 80 80)"`);
  for (const id of [...layerIds, "highlight"]) {
    const scale = scales[id === "highlight" ? "iris-blue" : id];
    const prefix = `id="${id}" transform="translate(80 80) scale(`;
    svg = replaceAnchor(svg, `${prefix}1) translate(-80 -80)"`, `${prefix}${scale.toFixed(6)}) translate(-80 -80)"`);
  }
  return replaceAnchor(svg, 'stroke="#dceaff"', `stroke="${appearance === "dark" ? "#dceaff" : "#172448"}"`);
}
