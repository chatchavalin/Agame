/**
 * A-Math Game — Rack
 *
 * Holds tiles for a single player. Maximum 8 tiles per Master Spec §1.3.
 * Per Master Spec §17.4: { owner, tiles: [Tile, ...] }
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
    };
  }

  /**
   * Adds a tile to the rack.
   * Throws if rack is already at max capacity (8).
   */
  function addTile(rack, tile) {
    if (rack.tiles.length >= C.RACK_SIZE) {
      throw new Error('Rack is full (' + C.RACK_SIZE + ' tiles)');
    }
    rack.tiles.push(tile);
  }

  /**
   * Removes a tile by its ID. Returns the removed tile, or null if not found.
   */
  function removeTile(rack, tileId) {
    const idx = rack.tiles.findIndex((t) => t.id === tileId);
    if (idx === -1) return null;
    return rack.tiles.splice(idx, 1)[0];
  }

  /**
   * Finds a tile in the rack by ID without removing it.
   */
  function findTile(rack, tileId) {
    return rack.tiles.find((t) => t.id === tileId) || null;
  }

  /**
   * Swap the positions of two tiles within the rack, identified by id.
   * Returns true on success, false if either tile is missing.
   */
  function swapTiles(rack, tileIdA, tileIdB) {
    if (tileIdA === tileIdB) return false;
    const idxA = rack.tiles.findIndex((t) => t.id === tileIdA);
    const idxB = rack.tiles.findIndex((t) => t.id === tileIdB);
    if (idxA === -1 || idxB === -1) return false;
    const tmp = rack.tiles[idxA];
    rack.tiles[idxA] = rack.tiles[idxB];
    rack.tiles[idxB] = tmp;
    return true;
  }

  /**
   * Draws tiles from the bag until rack has 8 (or bag is empty).
   * Returns the number of tiles actually drawn.
   */
  function refillFromBag(rack, bag) {
    const needed = C.RACK_SIZE - rack.tiles.length;
    if (needed <= 0) return 0;

    const drawn = B.drawN(bag, needed);
    for (const t of drawn) {
      rack.tiles.push(t);
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
  };
})();
