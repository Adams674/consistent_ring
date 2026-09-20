/**
 * A single point on a consistent hash ring. `hash` is a numeric value in the
 * ring's address space, and `node` is the resource being distributed.
 */
class RingPoint {
  /**
   * @param {number} hash
   * @param {string} node
   */
  constructor(hash, node) {
    this.hash = hash;
    this.node = node;
  }
}

/**
 * Consistent hash ring with virtual nodes.
 *
 * The ring maps string keys to a set of string node identifiers. Each physical
 * node is represented by `replicas` virtual nodes whose positions are derived
 * deterministically from the node identifier and a replica index. This reduces
 * the uneven key distribution that a single hash point per node can produce.
 *
 * The hash function must be supplied by the caller. It receives a string and
 * returns a non-negative integer. The caller is responsible for choosing a
 * hash function with adequate distribution for their key space. The default
 * implementation is FNV-1a 64-bit, which is fast and dependency-free but not
 * cryptographically strong.
 */
export class ConsistentRing {
  /**
   * @param {object} [options]
   * @param {string[]} [options.nodes] Initial node identifiers.
   * @param {number} [options.replicas=128] Virtual nodes per physical node.
   * @param {(key: string) => number} [options.hashFunction] Hash function returning a non-negative integer.
   */
  constructor(options = {}) {
    const {
      nodes = [],
      replicas = 128,
      hashFunction = ConsistentRing._fnv1a64,
    } = options;

    if (!Number.isInteger(replicas) || replicas < 1) {
      throw new RangeError('replicas must be a positive integer');
    }

    /** @type {number} */
    this.replicas = replicas;
    /** @type {(key: string) => number} */
    this.hashFunction = hashFunction;
    /** @type {RingPoint[]} */
    this._ring = [];
    /** @type {Map<string, number>} */
    this._nodeWeights = new Map();
    /** @type {Set<string>} */
    this._nodes = new Set();

    for (const node of nodes) {
      this.addNode(node);
    }
  }

  /**
   * Add a physical node to the ring.
   *
   * Adding a node that is already present is a no-op; the node's existing
   * virtual nodes are left untouched. This keeps repeated `addNode` calls
   * idempotent and avoids silently shifting key ownership when a client
   * re-registers a node.
   *
   * @param {string} node Node identifier.
   * @returns {this}
   */
  addNode(node) {
    if (typeof node !== 'string' || node.length === 0) {
      throw new TypeError('node must be a non-empty string');
    }
    if (this._nodes.has(node)) {
      return this;
    }

    this._nodes.add(node);
    const weight = this.replicas;
    this._nodeWeights.set(node, weight);

    for (let i = 0; i < weight; i += 1) {
      const hash = this.hashFunction(`${node}:${i}`);
      this._ring.push(new RingPoint(hash, node));
    }

    this._ring.sort((a, b) => a.hash - b.hash || a.node.localeCompare(b.node));
    return this;
  }

  /**
   * Remove a physical node and all of its virtual nodes.
   *
   * Removing a node that is not present is a no-op.
   *
   * @param {string} node Node identifier.
   * @returns {this}
   */
  removeNode(node) {
    if (!this._nodes.has(node)) {
      return this;
    }

    this._nodes.delete(node);
    this._nodeWeights.delete(node);
    this._ring = this._ring.filter((point) => point.node !== node);
    return this;
  }

  /**
   * Return the node responsible for `key`.
   *
   * The key is hashed once and the ring is searched for the first virtual node
   * whose hash is greater than or equal to that value. If the key hashes past
   * the end of the ring, ownership wraps to the first virtual node.
   *
   * @param {string} key
   * @returns {string | null} Responsible node, or null if the ring is empty.
   */
  getNode(key) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    if (this._ring.length === 0) {
      return null;
    }

    const hash = this.hashFunction(key);
    const point = this._findPoint(hash);
    return point.node;
  }

  /**
   * Return the nodes responsible for `key`, in order of ownership.
   *
   * The first entry is the primary owner returned by `getNode`. Subsequent
   * entries are the owners of the next distinct physical nodes encountered when
   * walking clockwise around the ring. The list stops when `count` distinct
   * nodes have been found or when the ring has been fully traversed, whichever
   * comes first. This is the standard consistent-hashing strategy for storing
   * replicas on distinct physical nodes.
   *
   * @param {string} key
   * @param {number} count Number of distinct nodes to return. Must be a positive integer.
   * @returns {string[]}
   */
  getNodes(key, count) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('count must be a positive integer');
    }
    if (this._ring.length === 0) {
      return [];
    }

    const startHash = this.hashFunction(key);
    let startIndex = this._findIndex(startHash);
    const result = [];
    const seen = new Set();

    for (let step = 0; step < this._ring.length && result.length < count; step += 1) {
      const point = this._ring[(startIndex + step) % this._ring.length];
      if (!seen.has(point.node)) {
        seen.add(point.node);
        result.push(point.node);
      }
    }

    return result;
  }

  /**
   * Return the number of physical nodes currently on the ring.
   * @returns {number}
   */
  size() {
    return this._nodes.size;
  }

  /**
   * Return a copy of the current node identifiers.
   * @returns {string[]}
   */
  getNodesList() {
    return [...this._nodes];
  }

  /**
   * Locate the first ring point whose hash is >= `hash`.
   * @param {number} hash
   * @returns {RingPoint}
   */
  _findPoint(hash) {
    return this._ring[this._findIndex(hash)];
  }

  /**
   * Binary search for the ring index whose hash is the first >= `hash`.
   * @param {number} hash
   * @returns {number}
   */
  _findIndex(hash) {
    let low = 0;
    let high = this._ring.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this._ring[mid].hash < hash) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low % this._ring.length;
  }

  /**
   * FNV-1a 64-bit hash. Returns a non-negative integer within JavaScript's
   * safe integer range. Multiplication is performed with BigInt to avoid
   * losing bits, then converted to a Number. The final modulo keeps the value
   * under 2^53 so all ring arithmetic stays in safe integer territory.
   *
   * @param {string} key
   * @returns {number}
   */
  static _fnv1a64(key) {
    const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
    const FNV_PRIME = 0x100000001b3n;
    const MODULUS = 0x20000000000000n; // 2^53

    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= BigInt(key.charCodeAt(i));
      hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
    }
    return Number(hash % MODULUS);
  }
}
