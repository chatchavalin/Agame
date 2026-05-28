/**
 * ELO Rating per pattern.
 * Start at 1200. Win/loss based on submit outcome.
 * Speed bonus: faster solves earn more rating points.
 *
 * Storage:
 *   amath_elo: { sectionId:patternId → { rating, history: [{ts, delta, after}] } }
 */
(function(){
  'use strict';
  const KEY = 'amath_elo';
  const START = 1200;
  
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch(e) { return {}; }
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch(e){}
  }
  
  function key(sid, pid) { return sid + ':' + pid; }
  
  function getRating(sid, pid) {
    const data = load();
    const k = key(sid, pid);
    if (!data[k]) return START;
    return data[k].rating;
  }
  
  function getOverall() {
    const data = load();
    const ratings = [];
    for (const k in data) ratings.push(data[k].rating);
    if (ratings.length === 0) return START;
    return Math.round(ratings.reduce(function(a,b){return a+b;}, 0) / ratings.length);
  }
  
  function getHistory(sid, pid, limit) {
    const data = load();
    const k = key(sid, pid);
    const hist = (data[k] && data[k].history) || [];
    return limit ? hist.slice(-limit) : hist;
  }
  
  // Win: correct submit
  // solveTime in seconds; faster = bigger gain
  // basis: K=16 base
  //   solveTime <= 10s → +24
  //   solveTime <= 20s → +16
  //   solveTime <= 30s → +12
  //   solveTime > 30s → +8 (still earned, lower)
  function applyWin(sid, pid, solveTime) {
    let delta = 8;
    if (solveTime <= 10) delta = 24;
    else if (solveTime <= 20) delta = 16;
    else if (solveTime <= 30) delta = 12;
    const data = load();
    const k = key(sid, pid);
    if (!data[k]) data[k] = { rating: START, history: [] };
    data[k].rating += delta;
    data[k].history.push({ ts: Date.now(), delta: delta, after: data[k].rating, type: 'win', solveTime: solveTime });
    // Cap history to last 50 entries to limit storage
    if (data[k].history.length > 50) data[k].history = data[k].history.slice(-50);
    save(data);
    return delta;
  }
  
  // Loss: incorrect submit OR explicit failure
  function applyLoss(sid, pid) {
    const delta = -10;
    const data = load();
    const k = key(sid, pid);
    if (!data[k]) data[k] = { rating: START, history: [] };
    data[k].rating += delta;
    if (data[k].rating < 800) data[k].rating = 800;  // floor
    data[k].history.push({ ts: Date.now(), delta: delta, after: data[k].rating, type: 'loss' });
    if (data[k].history.length > 50) data[k].history = data[k].history.slice(-50);
    save(data);
    return delta;
  }
  
  // Get ranks across all patterns — useful for "weakest pattern" detection
  function listAll() {
    const data = load();
    const list = [];
    for (const k in data) {
      const [sid, pid] = k.split(':');
      list.push({ sid, pid, rating: data[k].rating, plays: data[k].history.length });
    }
    return list;
  }
  
  function reset() {
    try { localStorage.removeItem(KEY); } catch(e){}
  }
  
  window.AMath = window.AMath || {};
  window.AMath.elo = {
    getRating: getRating,
    getOverall: getOverall,
    getHistory: getHistory,
    applyWin: applyWin,
    applyLoss: applyLoss,
    listAll: listAll,
    reset: reset,
    START: START,
  };
})();
