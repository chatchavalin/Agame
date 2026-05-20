/**
 * A-Math Game — Rack
 *
 * Holds tiles for a single player. Maximum 8 tiles per Master Spec §1.3.
 * Per Master Spec §17.4: { owner, tiles: [Tile, ...] }
 *
 * Position-stable display: the rack also tracks `slotMap` — a mapping
 * tileId → slot-index (0..7). When a tile is placed on the board and
 * later removed from the rack, the OTHER tiles retain their original
 * slot indices. When a refill happens, freed slots are filled in order.
 * The UI reads `slotMap` to render tiles in their assigned slots so
 * tiles don't appear to "shift left" after a placement.
 *
 * IMPORTANT: `rack.tiles` is still a packed array (no nulls) — all
 * existing AI code that iterates `rack.tiles` continues to work
 * untouched. Only the UI render layer consults `slotMap`.
 */

(function () {
  const C = window.AMath.constants;
  const B = window.AMath.bag;

  /**
   * Creates an empty rack for the given owner.
   * owner: 'player' | 'ai' | 'ai1' | 'ai2'
   */
  function createRack(owner) {
    return {
      owner: owner,
      tiles: [],
      slotMap: {},  // tileId -> slot-index (0..RACK_SIZE-1)
    };
  }

  /**
   * Returns the first slot-index (0..RACK_SIZE-1) not currently used in slotMap.
   */
  function firstFreeSlot(rack) {
    const used = new Set(Object.values(rack.slotMap));
    for (let i = 0; i < C.RACK_SIZE; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  }

  /**
   * Adds a tile to the rack at the first free slot.
   * Throws if rack is already at max capacity (8).
   */
  function addTile(rack, tile) {
    if (rack.tiles.length >= C.RACK_SIZE) {
      throw new Error('Rack is full (' + C.RACK_SIZE + ' tiles)');
    }
    rack.tiles.push(tile);
    const slot = firstFreeSlot(rack);
    if (slot !== -1) rack.slotMap[tile.id] = slot;
  }

  /**
   * Removes a tile by its ID. Returns the removed tile, or null if not found.
   * Other tiles' slot positions are preserved (they do NOT shift).
   */
  function removeTile(rack, tileId) {
    const idx = rack.tiles.findIndex((t) => t.id === tileId);
    if (idx === -1) return null;
    const removed = rack.tiles.splice(idx, 1)[0];
    delete rack.slotMap[tileId];
    return removed;
  }

  /**
   * Finds a tile in the rack by ID without removing it.
   */
  function findTile(rack, tileId) {
    return rack.tiles.find((t) => t.id === tileId) || null;
  }

  /**
   * Swap the positions of two tiles within the rack (visually), identified by id.
   * Returns true on success, false if either tile is missing.
   *
   * Note: this swaps the slot-indices in slotMap (which controls visual
   * position), NOT the order in `rack.tiles` (which the AI code reads).
   * For the AI, the rack still contains the same tiles either way.
   */
  function swapTiles(rack, tileIdA, tileIdB) {
    if (tileIdA === tileIdB) return false;
    const slotA = rack.slotMap[tileIdA];
    const slotB = rack.slotMap[tileIdB];
    if (slotA === undefined || slotB === undefined) return false;
    rack.slotMap[tileIdA] = slotB;
    rack.slotMap[tileIdB] = slotA;
    return true;
  }

  /**
   * Draws tiles from the bag until rack has 8 (or bag is empty).
   * New tiles are assigned to slot positions left vacated by removed tiles
   * (in left-to-right order). Returns the number of tiles actually drawn.
   */
  function refillFromBag(rack, bag) {
    const needed = C.RACK_SIZE - rack.tiles.length;
    if (needed <= 0) return 0;

    const drawn = B.drawN(bag, needed);
    for (const t of drawn) {
      rack.tiles.push(t);
      const slot = firstFreeSlot(rack);
      if (slot !== -1) rack.slotMap[t.id] = slot;
    }
    return drawn.length;
  }

  /**
   * Returns the total point value of all tiles currently on this rack.
   * Used for endgame scoring (Master Spec §1.9).
   * BLANK tiles count as 0 (Master Spec §1.9).
   */
  function rackPoints(rack) {
    let total = 0;
    for (const t of rack.tiles) {
      total += t.points; // BLANK already has points=0 in inventory
    }
    return total;
  }

  /**
   * Convenience: how many tiles in the rack right now.
   */
  function rackSize(rack) {
    return rack.tiles.length;
  }

  /**
   * Returns true if the rack has any tiles still left.
   */
  function isEmpty(rack) {
    return rack.tiles.length === 0;
  }

  /**
   * Returns an array of length RACK_SIZE where index `i` is the tile at
   * slot `i`, or null if that slot is empty. Used by the UI renderer.
   */
  function tilesBySlot(rack) {
    const out = new Array(C.RACK_SIZE);
    for (let i = 0; i < C.RACK_SIZE; i++) out[i] = null;
    for (const t of rack.tiles) {
      const slot = rack.slotMap[t.id];
      if (slot !== undefined && slot >= 0 && slot < C.RACK_SIZE) {
        out[slot] = t;
      }
    }
    return out;
  }

  // Expose
  window.AMath = window.AMath || {};
  window.AMath.rack = {
    createRack: createRack,
    addTile: addTile,
    removeTile: removeTile,
    findTile: findTile,
    swapTiles: swapTiles,
    refillFromBag: refillFromBag,
    rackPoints: rackPoints,
    rackSize: rackSize,
    isEmpty: isEmpty,
    tilesBySlot: tilesBySlot,
  };
})();
