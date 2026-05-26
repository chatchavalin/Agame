/**
 * A-Math AI Worker Client
 *
 * Main-thread wrapper that talks to ai-worker.js. Provides a Promise-based
 * `decideMove(state)` that mirrors the in-thread API but offloads search to
 * a Web Worker.
 *
 * Usage:
 *   const decision = await window.AMath.aiWorkerClient.decideMove(state);
 *
 * Worker is created lazily on first use. If Worker creation fails (some old
 * browsers, file:// protocol issues), `decideMove` falls back to running
 * AI on the main thread via window.AMath.aiPlayer.decideMove.
 *
 * Tile identity preservation:
 *   The worker receives a deep clone of state. When it returns placements,
 *   the tiles are clones with the same `id`. We re-map IDs to the actual
 *   tile references in the live session so animations/UI work correctly.
 */

(function () {
  let worker = null;
  let workerReady = false;
  let workerBroken = false;
  let nextRequestId = 1;
  const pendingRequests = new Map(); // requestId → { resolve, reject }

  function ensureWorker() {
    if (workerBroken) return null;
    if (worker) return worker;

    try {
      worker = new Worker('js/ai-worker.js?v=20260526b');
      worker.onmessage = handleWorkerMessage;
      worker.onerror = function (err) {
        console.error('[AI Worker] error:', err.message, 'at', err.filename, ':', err.lineno);
        // Reject all pending
        for (const [id, p] of pendingRequests) {
          p.reject(new Error('Worker error: ' + (err.message || 'unknown')));
        }
        pendingRequests.clear();
        workerBroken = true;
        worker = null;
      };
      return worker;
    } catch (e) {
      console.warn('[AI Worker] could not create:', e.message, '— falling back to main thread');
      workerBroken = true;
      return null;
    }
  }

  function handleWorkerMessage(e) {
    const msg = e.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'ready') {
      workerReady = true;
      return;
    }

    if (msg.type === 'decided' || msg.type === 'error') {
      const reqId = msg.requestId;
      const pending = pendingRequests.get(reqId);
      if (!pending) return;
      pendingRequests.delete(reqId);
      if (msg.type === 'decided') {
        pending.resolve(msg.decision);
      } else {
        const err = new Error(msg.error || 'Unknown worker error');
        if (msg.stack) err.stack = msg.stack;
        pending.reject(err);
      }
    }
  }

  /**
   * Serialize the state for the worker. Strips object references; keeps only
   * data. Settings are read from window.AMath.settings and embedded.
   */
  function serializeState(state) {
    // Read settings on main thread (worker can't access localStorage)
    const settings = {};
    try {
      if (window.AMath.settings && window.AMath.settings.get) {
        settings.aiThinkSeconds = window.AMath.settings.get('aiThinkSeconds');
        settings.aiSwapBrain = window.AMath.settings.get('aiSwapBrain');
        settings.tileSet = window.AMath.settings.get('tileSet');
        settings.disableSixPassEnd = window.AMath.settings.get('disableSixPassEnd');
        settings.botLevel = window.AMath.settings.get('botLevel');
      }
    } catch (e) {/* */}

    // Note: structured clone handles nested objects fine; we don't need
    // explicit serialization, but we DO want to attach _settings.
    // If the caller already set _settings (e.g., education forcing hard level),
    // merge them — caller overrides take priority.
    const merged = Object.assign({}, settings, state._settings || {});
    return Object.assign({}, state, { _settings: merged });
  }

  /**
   * Re-map tile IDs in returned placements back to actual tile objects in
   * the live aiRack. This is essential — the live tiles carry state
   * (like .assigned) that drives the UI rendering.
   *
   * If a placement references a tile whose ID isn't in the live rack
   * (shouldn't happen normally), we keep the worker's clone.
   */
  function remapTilesInDecision(decision, originalRack, originalBoard) {
    if (!decision || decision.type !== 'play' || !decision.placements) return decision;

    // Build ID → tile map from original rack
    const rackById = new Map();
    if (originalRack && originalRack.tiles) {
      for (const t of originalRack.tiles) rackById.set(t.id, t);
    }
    // Also map from board (for anchor tiles already on board)
    if (originalBoard && originalBoard.cells) {
      for (const row of originalBoard.cells) {
        for (const cell of row) {
          if (cell && cell.tile) rackById.set(cell.tile.id, cell.tile);
        }
      }
    }

    decision.placements = decision.placements.map(function (p) {
      if (p.tile && p.tile.id && rackById.has(p.tile.id)) {
        const live = rackById.get(p.tile.id);
        // Preserve assigned face from worker's decision
        if (p.assigned) live.assigned = p.assigned;
        return Object.assign({}, p, { tile: live });
      }
      return p;
    });

    return decision;
  }

  /**
   * Run decideMove via the worker. Returns a promise.
   * Falls back to main-thread execution if worker is unavailable.
   */
  function decideMove(state) {
    const w = ensureWorker();
    if (!w) {
      // Fallback: run on main thread
      console.warn('[AI Worker] using main-thread fallback');
      return window.AMath.aiPlayer.decideMove(state);
    }

    const requestId = nextRequestId++;
    const serialized = serializeState(state);

    return new Promise(function (resolve, reject) {
      pendingRequests.set(requestId, {
        resolve: function (decision) {
          // Remap tile IDs back to live references
          const remapped = remapTilesInDecision(decision, state.aiRack, state.board);
          resolve(remapped);
        },
        reject: reject,
      });

      try {
        w.postMessage({ type: 'decide', requestId: requestId, state: serialized });
      } catch (err) {
        pendingRequests.delete(requestId);
        // postMessage failed (rare — maybe non-cloneable object?) — fall back
        console.warn('[AI Worker] postMessage failed, using main thread:', err.message);
        window.AMath.aiPlayer.decideMove(state).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Terminate the worker (e.g., on game reset). Pending requests are rejected.
   */
  function terminate() {
    if (worker) {
      worker.terminate();
      worker = null;
      workerReady = false;
    }
    for (const [id, p] of pendingRequests) {
      p.reject(new Error('Worker terminated'));
    }
    pendingRequests.clear();
  }

  window.AMath = window.AMath || {};
  window.AMath.aiWorkerClient = {
    decideMove: decideMove,
    terminate: terminate,
    isAvailable: function () { return !workerBroken; },
  };
})();
