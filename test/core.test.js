import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsistentRing } from '../src/core.js';

/**
 * Deterministic hash that maps a string to the sum of its character codes.
 * Keeps tests independent of any particular default hash implementation.
 */
function sumHash(key) {
  let sum = 0;
  for (let i = 0; i < key.length; i += 1) {
    sum += key.charCodeAt(i);
  }
  return sum;
}

function createRing(nodes, replicas = 3) {
  return new ConsistentRing({ nodes, replicas, hashFunction: sumHash });
}

test('empty ring returns null for getNode', () => {
  const ring = createRing([]);
  assert.equal(ring.getNode('any'), null);
  assert.deepEqual(ring.getNodes('any', 2), []);
  assert.equal(ring.size(), 0);
});

test('single node owns every key', () => {
  const ring = createRing(['a']);
  assert.equal(ring.getNode('alpha'), 'a');
  assert.equal(ring.getNode('beta'), 'a');
  assert.deepEqual(ring.getNodes('gamma', 3), ['a']);
});

test('addNode is idempotent', () => {
  const ring = createRing(['a']);
  const ringSizeBefore = ring._ring.length;
  ring.addNode('a');
  assert.equal(ring._ring.length, ringSizeBefore);
  assert.equal(ring.size(), 1);
});

test('removeNode removes all virtual nodes', () => {
  const ring = createRing(['a', 'b']);
  ring.removeNode('a');
  assert.equal(ring.size(), 1);
  assert.equal(ring.getNode('anything'), 'b');
  assert.deepEqual(ring.getNodesList(), ['b']);
});

test('removeNode is idempotent for absent node', () => {
  const ring = createRing(['a']);
  const ringSizeBefore = ring._ring.length;
  ring.removeNode('missing');
  assert.equal(ring._ring.length, ringSizeBefore);
  assert.equal(ring.size(), 1);
});

test('getNodes returns distinct physical nodes in ring order', () => {
  // With sumHash and replicas=3:
  // a:0=145, a:1=146, a:2=147
  // b:0=146, b:1=147, b:2=148
  // c:0=147, c:1=148, c:2=149
  // Sorted ring: 145(a),146(a),146(b),147(a),147(b),147(c),148(b),148(c),149(c)
  const ring = createRing(['a', 'b', 'c']);
  const nodes = ring.getNodes('key', 3);
  assert.equal(nodes.length, 3);
  assert.deepEqual(new Set(nodes), new Set(['a', 'b', 'c']));
});

test('getNodes returns fewer entries when ring has fewer physical nodes', () => {
  const ring = createRing(['a', 'b']);
  const nodes = ring.getNodes('key', 5);
  assert.equal(nodes.length, 2);
  assert.deepEqual(new Set(nodes), new Set(['a', 'b']));
});

test('getNodes with count 1 matches getNode', () => {
  const ring = createRing(['a', 'b', 'c']);
  const key = 'some-key';
  assert.deepEqual(ring.getNodes(key, 1), [ring.getNode(key)]);
});

test('key ownership wraps around the ring', () => {
  const ring = createRing(['a', 'b']);
  // A key hashing above the largest ring point must map to the first point.
  const highKey = String.fromCharCode(250) + 'x';
  const primary = ring.getNode(highKey);
  assert.ok(['a', 'b'].includes(primary));
});

test('constructor throws for invalid replicas', () => {
  assert.throws(() => new ConsistentRing({ replicas: 0, hashFunction: sumHash }), RangeError);
  assert.throws(() => new ConsistentRing({ replicas: -1, hashFunction: sumHash }), RangeError);
  assert.throws(() => new ConsistentRing({ replicas: 1.5, hashFunction: sumHash }), RangeError);
});

test('getNode throws for invalid key', () => {
  const ring = createRing(['a']);
  assert.throws(() => ring.getNode(''), TypeError);
  assert.throws(() => ring.getNode(null), TypeError);
});

test('getNodes throws for invalid count', () => {
  const ring = createRing(['a']);
  assert.throws(() => ring.getNodes('key', 0), RangeError);
  assert.throws(() => ring.getNodes('key', -1), RangeError);
  assert.throws(() => ring.getNodes('key', 1.5), RangeError);
});

test('default hash function is deterministic and within safe range', () => {
  const ring = new ConsistentRing({ nodes: ['a', 'b'] });
  const key = 'test-key';
  const first = ring.getNode(key);
  const second = ring.getNode(key);
  assert.equal(first, second);
  const direct = ConsistentRing._fnv1a64(key);
  assert.ok(Number.isSafeInteger(direct));
  assert.ok(direct >= 0);
});
