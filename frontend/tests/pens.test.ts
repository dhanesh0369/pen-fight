// Unit tests for pen stats and point-of-contact shot physics. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShot, PEN_TYPES, PEN_TYPE_IDS, BASE_SPIN } from '../src/game/pens.ts';

const bp = PEN_TYPES.ballpoint;
const half = bp.length / 2;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('center hit gives straight push, no spin, full power', () => {
  const s = computeShot(bp, 0, 0, 0, 1, 1);
  close(s.angularVelocity, 0);
  close(s.forceX, 0);
  close(s.forceY, bp.launchPower);
});

test('flick along the axis gives no spin even at the tip', () => {
  const s = computeShot(bp, 0, half, 1, 0, 1);
  close(s.spinAmount, 0);
  close(s.forceX, bp.launchPower);
});

test('tip + perpendicular flick = max spin and energy loss', () => {
  const s = computeShot(bp, 0, half, 0, 1, 1);
  close(s.spinAmount, 1);
  close(s.angularVelocity, BASE_SPIN * bp.spinMultiplier);
  close(s.forceY, bp.launchPower * 0.65);
});

test('spin direction follows r x F (right end pushed down = clockwise/+)', () => {
  assert.ok(computeShot(bp, 0, half, 0, 1, 1).angularVelocity > 0);
  assert.ok(computeShot(bp, 0, -half, 0, 1, 1).angularVelocity < 0);
  assert.ok(computeShot(bp, 0, half, 0, -1, 1).angularVelocity < 0);
});

test('rotation of the pen is respected', () => {
  // Pen rotated 90deg: axis points +y. Flicking along y => no spin; along x => spin.
  close(computeShot(bp, Math.PI / 2, half, 0, 1, 1).spinAmount, 0);
  close(Math.abs(computeShot(bp, Math.PI / 2, half, 1, 0, 1).spinAmount), 1);
});

test('contact beyond pen length is clamped', () => {
  close(computeShot(bp, 0, half * 5, 0, 1, 1).spinAmount, 1);
});

test('power scales force and spin linearly', () => {
  const full = computeShot(bp, 0, half / 2, 0, 1, 1);
  const halfP = computeShot(bp, 0, half / 2, 0, 1, 0.5);
  close(halfP.forceY, full.forceY / 2);
  close(halfP.angularVelocity, full.angularVelocity / 2);
});

test('pen ordering: heavy is heaviest & spins least; light spins most', () => {
  const g = PEN_TYPES.gel, m = PEN_TYPES.marker;
  assert.ok(g.mass > m.mass && m.mass > bp.mass);
  assert.ok(bp.spinMultiplier > m.spinMultiplier && m.spinMultiplier > g.spinMultiplier);
  assert.ok(bp.restitution > m.restitution && m.restitution > g.restitution);
});

test('launch speeds are comparable (within 25%) across pens, heavy has most momentum', () => {
  const speeds = PEN_TYPE_IDS.map(id => PEN_TYPES[id].launchPower / PEN_TYPES[id].mass);
  const max = Math.max(...speeds), min = Math.min(...speeds);
  assert.ok(max / min < 1.25, `speed spread ${max / min}`);
  const momentum = (id: keyof typeof PEN_TYPES) => PEN_TYPES[id].launchPower; // impulse = F*dt
  assert.ok(momentum('gel') > momentum('marker') && momentum('marker') > momentum('ballpoint'));
});
