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

// Cache-bust version — bumped whenever any imported AI module changes.
// Without this, the worker would serve cached old AI code even after a
// hard refresh on the main page (worker has its own cache lifecycle).
const CACHE_V = '?v=v209';

// Load all AI dependencies. Order matters — match what index.html loads.
try {
  importScripts(
    'constants.js' + CACHE_V,
    'utils.js' + CACHE_V,
    'evaluator.js' + CACHE_V,
    'bag.js' + CACHE_V,
    'rack.js' + CACHE_V,
    'board.js' + CACHE_V,
    'scoring.js' + CACHE_V,
    'placement.js' + CACHE_V,
    'ai-yoyo.js' + CACHE_V,
    'ai-x9.js' + CACHE_V,
    'ai-x4.js' + CACHE_V,
    'ai-patterns-data.js' + CACHE_V,
    'ai-patterns-engine.js' + CACHE_V,
    'ai-bingo-fast.js' + CACHE_V,
    'ai-bingo-grammar.js' + CACHE_V,
    'ai-swap.js' + CACHE_V,
    'ai-swap-brain2.js' + CACHE_V,
    'ai-player.js' + CACHE_V
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
        // Attach top plays from the search for education mode
        if (self.AMath.aiPlayer.getLastTopPlays) {
          decision._topPlays = self.AMath.aiPlayer.getLastTopPlays();
        }
        // Attach the search diagnostics so the main thread can log them
        // (the worker has its own isolated aiPlayer; main thread can't read it).
        if (self.AMath.aiPlayer._lastDecisionDiag) {
          decision._diag = self.AMath.aiPlayer._lastDecisionDiag;
        }
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
