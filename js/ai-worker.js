/**
 * A-Math AI — Web Worker bootstrap.
 *
 * This script runs in a Web Worker context. It loads all AI dependencies via
 * importScripts() and listens for "decide" messages from the main thread.
 *
 * Architecture:
 *   Main thread          →  postMessage({type:'decide', state})  →   Worker
 *   Worker (this file)   →  runs AI.decideMove(state)
 *   Worker               →  postMessage({type:'decided', decision})  →  Main thread
 *
 * Why this exists:
 *   AI search is CPU-heavy and synchronous (with periodic yields). Running it on
 *   the main thread can cause UI freezes even with yields. A Worker thread keeps
 *   the UI perfectly responsive — the timer ticks smoothly, hover/scroll/clicks
 *   all work, no jank during 3-minute AI think times.
 *
 * Caveats:
 *   - Worker has no DOM/window. We alias `self.window = self` so existing
 *     `window.AMath.*` access works (the AI modules register into AMath namespace).
 *   - Settings can't be read from localStorage. Main thread serializes settings
 *     into state._settings before posting.
 *   - Tile/board/bag objects are deep-cloned via structured clone. Tile identity
 *     is preserved via the `id` field; main thread maps returned IDs back to
 *     actual tile references.
 */

// Alias window → self so all `window.AMath.*` references in AI modules work
self.window = self;

// Load all AI dependencies. Order matters — match what index.html loads.
try {
  importScripts(
    'constants.js',
    'utils.js',
    'evaluator.js',
    'bag.js',
    'rack.js',
    'board.js',
    'scoring.js',
    'placement.js',
    'ai-yoyo.js',
    'ai-x9.js',
    'ai-x4.js',
    'ai-patterns-data.js',
    'ai-patterns-engine.js',
    'ai-bingo-fast.js',
    'ai-bingo-grammar.js',
    'ai-swap.js',
    'ai-swap-brain2.js',
    'ai-player.js'
  );
} catch (err) {
  self.postMessage({ type: 'error', error: 'Worker importScripts failed: ' + err.message });
  throw err;
}

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'decide') {
    try {
      const state = msg.state;
      // decideMove is async — wait for it
      const p = self.AMath.aiPlayer.decideMove(state);
      Promise.resolve(p).then(function (decision) {
        // Strip any internal-only fields; keep just what main thread needs
        self.postMessage({
          type: 'decided',
          requestId: msg.requestId,
          decision: decision,
        });
      }).catch(function (err) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          error: (err && err.message) || String(err),
          stack: err && err.stack,
        });
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: (err && err.message) || String(err),
        stack: err && err.stack,
      });
    }
  }
};

// Signal ready
self.postMessage({ type: 'ready' });
