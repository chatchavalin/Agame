/**
 * A-Math Game — Tile Bag
 *
 * Holds unplayed tiles. Players draw tiles from it; on swap, tiles return to it.
 * Per Master Spec §1.10: "no score penalty for swapping" and "swap uses up the turn".
 * Per Master Spec §17.5: { tiles: [Tile, Tile, ...] } - drawing pops from the end.
 */

(function () {
  const C = window.AMath.constants;
  const U = window.AMath.utils;

  /**
   * Creates a fresh, shuffled bag containing tiles per the active inventory
   * (ประถม = 70 tiles, มัธยม = 100 tiles).
   * Each tile gets a unique ID.
   */
  function createBag() {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const tiles = [];
    for (const def of inventory) {
      for (let i = 0; i < def.count; i++) {
        tiles.push({
          id: U.generateId('tile'),
          type: def.type,
          face: def.face,
          points: def.points,
          assigned: null, // For BLANK and choice tiles, set when placed
        });
      }
    }
    U.shuffle(tiles);
    return { tiles: tiles };
  }

  /**
   * Removes and returns the top tile from the bag.
   * Returns null if the bag is empty.
   */
  function drawTile(bag) {
    if (bag.tiles.length === 0) return null;
    return bag.tiles.pop();
  }

  /**
   * Draws up to n tiles. Returns however many were available (could be fewer than n).
   * Returns an array (possibly empty).
   */
  function drawN(bag, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      const t = drawTile(bag);
      if (t === null) break;
      drawn.push(t);
    }
    return drawn;
  }

  /**
   * Returns tiles to the bag and reshuffles (used in the swap operation).
   * Resets any assigned values on blank/choice tiles so they can be reused fresh.
   */
  function returnTiles(bag, tiles) {
    for (const t of tiles) {
      // Reset assigned value (BLANK/+/- /×÷ should be "fresh" again)
      const fresh = {
        id: t.id,
        type: t.type,
        face: t.face,
        points: t.points,
        assigned: null,
      };
      bag.tiles.push(fresh);
    }
    U.shuffle(bag.tiles);
  }

  /**
   * How many tiles remain in the bag.
   */
  function bagSize(bag) {
    return bag.tiles.length;
  }

  // Expose
  window.AMath = window.AMath || {};
  window.AMath.bag = {
    createBag: createBag,
    drawTile: drawTile,
    drawN: drawN,
    returnTiles: returnTiles,
    bagSize: bagSize,
  };
})();
