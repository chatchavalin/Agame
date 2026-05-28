/**
 * Tournament Prep — date countdown + weak-spot detection + daily plan.
 *
 * Storage:
 *   amath_tournament = { date: "2026-06-15", name: "...", archived: [...] }
 *
 * Weak-spot detection combines:
 *   - ELO rating per pattern (lower = weaker)
 *   - accuracy per pattern (from progress attempts vs solves)
 *   - avg solve time per pattern (slower = weaker), weighted heaviest
 *     because tournaments are time-pressured (per Q5: both, time wins ties)
 */
(function(){
  'use strict';
  const KEY = 'amath_tournament';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch(e) { return null; }
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch(e){}
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function setDate(dateISO, name) {
    let data = load() || { archived: [] };
    // If there's an existing future date, archive it first
    if (data.date && data.date !== dateISO) {
      data.archived = data.archived || [];
      data.archived.push({ date: data.date, name: data.name || '' });
    }
    data.date = dateISO;
    data.name = name || '';
    save(data);
    return data;
  }

  function getDate() {
    const data = load();
    return data ? data.date : null;
  }

  function getName() {
    const data = load();
    return data ? (data.name || '') : '';
  }

  function clear() {
    const data = load();
    if (!data) return;
    // Move current to archive, clear active date
    if (data.date) {
      data.archived = data.archived || [];
      data.archived.push({ date: data.date, name: data.name || '' });
    }
    data.date = null;
    data.name = '';
    save(data);
  }

  // Days until tournament (negative if past)
  function daysUntil() {
    const date = getDate();
    if (!date) return null;
    const today = new Date(todayISO() + 'T00:00:00');
    const target = new Date(date + 'T00:00:00');
    const diffMs = target - today;
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  // Auto-archive if the tournament date has passed
  function checkExpiry() {
    const d = daysUntil();
    if (d !== null && d < 0) {
      clear();
      return true; // expired and archived
    }
    return false;
  }

  /**
   * Weak-spot detection. Scans ELO + progress data per pattern.
   * Returns sorted list (weakest first) of { sid, pid, label, score, rating, accuracy, avgTime }.
   *
   * Composite weakness score (higher = weaker):
   *   - rating component: (1400 - rating) normalized
   *   - accuracy component: (100 - accuracyPct)
   *   - time component: avgTime (capped), weighted ×1.5 (time wins ties)
   *
   * bookData needed to map pattern ids → labels and enumerate patterns.
   */
  function weakSpots(bookData, limit) {
    if (!bookData) return [];
    const elo = window.AMath && window.AMath.elo;
    const prog = window.AMath && window.AMath.progress;
    if (!elo || !prog) return [];

    // Load raw progress data
    let solved = {}, attempts = {};
    try { solved = JSON.parse(localStorage.getItem('amath_progress_solved') || '{}'); } catch(e){}
    try { attempts = JSON.parse(localStorage.getItem('amath_progress_attempts') || '{}'); } catch(e){}

    const eloData = (function(){ try { return JSON.parse(localStorage.getItem('amath_elo') || '{}'); } catch(e){ return {}; } })();

    const results = [];
    ['ton1','ton2','ton3'].forEach(function(sid){
      const sec = bookData[sid];
      if (!sec || !sec.patterns) return;
      sec.patterns.forEach(function(pat){
        const pid = pat.id;
        const k = sid + ':' + pid;
        const rating = (eloData[k] && eloData[k].rating) || 1200;

        // Count solved + attempts for this pattern
        let solvedCount = 0, attemptCount = 0;
        const solvePrefix = sid + ':' + pid + ':';
        for (const sk in solved) if (solved[sk] && sk.startsWith(solvePrefix)) solvedCount++;
        for (const ak in attempts) if (ak.startsWith(solvePrefix)) attemptCount += attempts[ak];
        const accuracy = attemptCount > 0 ? Math.round((solvedCount / attemptCount) * 100) : 0;

        // Avg solve time from ELO history (win events store solveTime)
        let avgTime = 0;
        const hist = (eloData[k] && eloData[k].history) || [];
        const times = hist.filter(function(h){ return h.type === 'win' && typeof h.solveTime === 'number'; })
                          .map(function(h){ return h.solveTime; });
        if (times.length > 0) {
          avgTime = times.reduce(function(a,b){return a+b;}, 0) / times.length;
        }

        // Only include patterns the player has actually attempted — otherwise
        // we'd just list everything at 1200/0%/0s which isn't a real weak spot.
        const touched = attemptCount > 0;

        // Composite weakness
        const ratingComp = Math.max(0, 1400 - rating) / 10;     // 0..60
        const accComp = (100 - accuracy);                         // 0..100
        const timeComp = Math.min(avgTime, 60) * 1.5;             // 0..90, weighted
        const weakness = ratingComp + accComp + timeComp;

        results.push({
          sid: sid, pid: pid, label: pat.label,
          rating: rating, accuracy: accuracy, avgTime: Math.round(avgTime),
          attempts: attemptCount, solved: solvedCount,
          weakness: weakness, touched: touched
        });
      });
    });

    // Sort: touched patterns first (by weakness desc), then untouched
    results.sort(function(a, b){
      if (a.touched && !b.touched) return -1;
      if (!a.touched && b.touched) return 1;
      return b.weakness - a.weakness;
    });

    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Generate today's recommended training plan based on weak spots and
   * days remaining. Returns { intensity, patterns: [...], message }.
   */
  function dailyPlan(bookData) {
    const days = daysUntil();
    const weak = weakSpots(bookData, 3);

    let intensity, message;
    if (days === null) {
      intensity = 'normal';
      message = 'Set a tournament date to get a tailored prep plan.';
    } else if (days <= 3) {
      intensity = 'high';
      message = 'Final days! High-intensity speed rounds on your weak patterns.';
    } else if (days <= 7) {
      intensity = 'medium';
      message = 'One week out. Drill weak patterns daily, mix in speed rounds.';
    } else {
      intensity = 'normal';
      message = days + ' days out. Steady practice — focus on weak spots.';
    }

    return { intensity: intensity, patterns: weak, message: message, days: days };
  }

  window.AMath = window.AMath || {};
  window.AMath.tournament = {
    setDate: setDate,
    getDate: getDate,
    getName: getName,
    clear: clear,
    daysUntil: daysUntil,
    checkExpiry: checkExpiry,
    weakSpots: weakSpots,
    dailyPlan: dailyPlan,
  };
})();
