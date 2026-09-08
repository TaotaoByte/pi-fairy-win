import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Resvg } from "@resvg/resvg-js";
import { cycleMs, easeEyePhase, frameSvg, manifest, motion, sampleMotion, validateMotion } from "../scripts/frame-svg.mjs";

const source = readFileSync(new URL("../assets/fairy.svg", import.meta.url), "utf8");
const close = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("frame-svg: faithful amplitudes and inside-to-outside phase leads, not whole-eye bobbing", () => {
  assert.equal(cycleMs, 6000);
  assert.equal(motion.breathMs, 1500);
  assert.equal(motion.rotationMs, 12000);
  assert.deepEqual(motion.bezier, [0.72, 0, 0.28, 1]);
  const expected = {
    sclera: [0.985, 0.91, 0], "iris-outer": [1, 0.90, 1 / 32],
    "iris-blue": [1, 0.87, 1 / 16], pupil: [1, 0.85, 1 / 8],
  };
  for (const [id, [expanded, contracted, lead]] of Object.entries(expected)) {
    assert.deepEqual(motion.layers[id], { expanded, contracted, lead });
    close(sampleMotion(-lead * motion.breathMs).scales[id], expanded);
    close(sampleMotion((0.5 - lead) * motion.breathMs).scales[id], contracted);
    const samples = Array.from({ length: 30 }, (_, i) => sampleMotion(i * 50).scales[id]);
    assert.ok(Math.max(...samples) - Math.min(...samples) > (expanded - contracted) * 0.99);
  }
  const initial = sampleMotion(0).scales;
  assert.ok(initial.pupil < initial["iris-blue"] && initial["iris-blue"] < initial["iris-outer"]);
  close(sampleMotion(50).angle, 1.5);
  close(sampleMotion(1500).angle, 45);
});

test("frame-svg: CSS Bezier time inversion and symmetric alternating progress", () => {
  close(easeEyePhase(0), 0);
  close(easeEyePhase(1), 1);
  close(easeEyePhase(0.5), 0.5);
  assert.ok(easeEyePhase(0.25) < 0.07, "not a sine or linear time curve");
  for (let x = 0; x <= 1; x += 0.05) close(easeEyePhase(x) + easeEyePhase(1 - x), 1);
});

test("frame-svg: exact joint closure, including samples on both sides of square rotation wrap", () => {
  for (const time of [-50, 0, 50, 745, 1500, 2950, 3000, 3050, 5950]) {
    assert.deepEqual(sampleMotion(time), sampleMotion(time + cycleMs));
    for (const appearance of manifest.variants) {
      assert.equal(frameSvg(source, time, appearance), frameSvg(source, time + cycleMs, appearance));
    }
  }
  const png = (time: number) => new Resvg(frameSvg(source, time, "dark")).render().asPng();
  assert.deepEqual(png(0), png(cycleMs));
  assert.notDeepEqual(png(0), png(cycleMs - 50), "do not duplicate endpoint/dwell");
  assert.throws(() => validateMotion({ ...motion, rotationMs: 15000 }), /must close/);
  assert.throws(() => validateMotion({ ...motion, breathMs: 1440 }), /must close/);
});

test("frame-svg: standalone geometry, white halos in both themes, anchored edits fail loudly", () => {
  assert.ok(source.includes('viewBox="-1 -1 162 162"'));
  for (const appearance of manifest.variants) {
    const svg = frameSvg(source, 350, appearance);
    const transform = (id: string) => svg.match(new RegExp(`id="${id}" transform="([^"]+)"`))![1];
    assert.equal(transform("highlight"), transform("iris-blue"));
    assert.notEqual(transform("sclera"), transform("pupil"));
    assert.ok(svg.includes('stop-color="#ffffff" stop-opacity=".28"'));
    assert.ok(!svg.includes("var(--"));
    for (const id of ["corners", "sclera", "iris-outer", "iris-blue", "pupil", "highlight"]) {
      assert.throws(() => frameSvg(source.replace(`id="${id}"`, 'id="missing"'), 0, appearance), /anchor/);
    }
    assert.throws(() => frameSvg(source.replace('stroke="#dceaff"', 'stroke="#ffffff"'), 0, appearance), /anchor/);
  }
});

test("frame-svg: baked frames match their editable sources at motion and seam landmarks", () => {
  for (const appearance of manifest.variants) {
    for (const frame of [0, 1, 11, 15, 30, 59, 60, 61, 119]) {
      const generated = new Resvg(frameSvg(source, frame * 50, appearance)).render().asPng();
      const stored = readFileSync(new URL(`../assets/frames/${appearance}/${String(frame).padStart(3, "0")}.png`, import.meta.url));
      assert.deepEqual(generated, stored);
    }
  }
});
