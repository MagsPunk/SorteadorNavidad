import test from "node:test";
import assert from "node:assert/strict";
import { drawCircle, drawWithRestrictions } from "../src/index.js";

test("sorteo de 18: todos dan a una persona distinta y todos reciben una vez", () => {
  const ids = Array.from({ length: 18 }, (_, i) => i + 1);
  for (let k = 0; k < 1000; k++) {
    const pairs = drawCircle(ids);
    assert.deepEqual(new Set(pairs.map(p => p[0])), new Set(ids));
    assert.deepEqual(new Set(pairs.map(p => p[1])), new Set(ids));
    assert.ok(pairs.every(([giver, receiver]) => giver !== receiver));
  }
});

test("exclusión mutua y restricciones previas del servidor", () => {
  const people = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, name: `Persona${i + 1}` }));
  for (let k = 0; k < 1000; k++) {
    const pairs = drawWithRestrictions(
      people, JSON.stringify([["Persona3", "Persona5"]]), [["Persona1", "Persona2"]]
    );
    assert.ok(pairs);
    const map = new Map(pairs);
    assert.equal(map.size, 18);
    assert.equal(new Set(map.values()).size, 18);
    assert.notEqual(map.get(1), 2);
    assert.notEqual(map.get(2), 1);
    assert.notEqual(map.get(3), 5);
    assert.ok(pairs.every(([giver, receiver]) => giver !== receiver));
  }
});

test("rechaza exclusiones inválidas sin publicar resultados", () => {
  const people = [{ id: 1, name: "Uno" }, { id: 2, name: "Dos" }];
  assert.equal(drawWithRestrictions(people, null, [["Uno", "Desconocido"]]), null);
  assert.equal(drawWithRestrictions(people, "no-json", []), null);
  assert.equal(drawWithRestrictions(people, null, [["Uno", "Dos"]]), null);
});

test("no acepta un único participante", () => {
  assert.throws(() => drawCircle([1]));
});
