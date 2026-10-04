# Consistent Ring

Consistent Ring is a dependency-free consistent hashing library with virtual nodes. It maps string keys to a set of string node identifiers and keeps that mapping stable as nodes are added or removed.

```js
import { ConsistentRing } from 'consistent-ring';

const ring = new ConsistentRing({
  nodes: ['cache-1', 'cache-2', 'cache-3'],
  replicas: 128,
});

const owner = ring.getNode('user:42:session');
console.log(owner);
```

The default hash function is FNV-1a 64-bit. You can supply your own hash function through the `hashFunction` option; it must accept a string and return a non-negative integer.

## Why this library exists

Naive key-to-node mapping such as `hash(key) % nodeCount` moves nearly every key when the node count changes. Consistent hashing places nodes and keys on the same ring and assigns each key to the next node clockwise. Adding or removing a node only moves the keys that fall into that node's segment.

A single ring point per physical node can create large ownership imbalances. Virtual nodes address this by giving each physical node many deterministic positions on the ring. The trade-off is memory: the ring stores `nodes * replicas` entries. The default of 128 replicas is a reasonable balance for typical cache clusters; raise it if key distribution tests show hotspots.

## Awkward edge

`getNodes(key, count)` walks clockwise and returns distinct physical nodes. If the ring contains fewer physical nodes than `count`, it returns all of them. It does not wrap around a second time to fill the count, because doing so would return duplicate nodes and mislead callers about replica placement.

## API

### `new ConsistentRing(options)`

- `options.nodes`: string array of initial node identifiers. Default `[]`.
- `options.replicas`: positive integer virtual nodes per physical node. Default `128`.
- `options.hashFunction`: `(key: string) => number`. Default is FNV-1a 64-bit.

### `ring.addNode(node)`

Adds a physical node and its virtual nodes. Idempotent: adding an existing node does nothing. Returns the ring instance.

### `ring.removeNode(node)`

Removes a physical node and all its virtual nodes. Idempotent for absent nodes. Returns the ring instance.

### `ring.getNode(key)`

Returns the node responsible for `key`, or `null` if the ring is empty.

### `ring.getNodes(key, count)`

Returns up to `count` distinct physical nodes responsible for `key`, starting with the primary owner and continuing clockwise. Returns an empty array if the ring is empty.

### `ring.size()`

Returns the number of physical nodes currently on the ring.

### `ring.getNodesList()`

Returns a copy of the current node identifiers.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

