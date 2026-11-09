import test from "node:test";
import assert from "node:assert/strict";
import { drawCircle } from "../src/index.js";

test("nadie se regala a sí mismo y todos reciben exactamente una vez", () => {
  const ids = [1,2,3,4,5];
  for(let k=0;k<1000;k++) {
    const pairs = drawCircle(ids);
    assert.deepEqual(new Set(pairs.map(p=>p[0])), new Set(ids));
    assert.deepEqual(new Set(pairs.map(p=>p[1])), new Set(ids));
    assert.ok(pairs.every(([giver,receiver])=>giver!==receiver));
  }
});

test("no acepta un único participante", () => {
  assert.throws(() => drawCircle([1]));
});
