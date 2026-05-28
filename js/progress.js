/**
 * Puzzle Mode Progress Tracker
 * 
 * Tracks per-pattern/per-set solve state, daily activity for streak,
 * and overall stats. All data persists in localStorage.
 * 
 * Storage keys:
 *   amath_progress_solved   → { "ton2:ton2-p1:3": true, ... }
 *                             "{sectionId}:{patternId}:{problemIdx}"
 *   amath_progress_attempts → { "ton2:ton2-p1:3": 5, ... }
 *                             count of submit attempts per problem
 *   amath_progress_dates    → ["2026-05-27", "2026-05-28", ...]
 *                             sorted unique YYYY-MM-DD dates of activity
 *   amath_progress_seen     → { "ton1": true, "ton2": true, ... }
 *                             which section cards the player has opened
 *   amath_progress_daily    → { date: "2026-05-28", challenge: {sid, pid, idx} }
 *                             today's daily challenge
 */
(function () {
  'use strict';

  const KEYS = {
    solved:   'amath_progress_solved',
    attempts: 'amath_progress_attempts',
    dates:    'amath_progress_dates',
    seen:     'amath_progress_seen',
    daily:    'amath_progress_daily',
  };

  function load(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) { return defaultVal; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) {}
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // Mark a problem as solved (correct submit)
  function markSolved(sectionId, patternId, problemIdx) {
    const solved = load(KEYS.solved, {});
    const key = sectionId + ':' + patternId + ':' + problemIdx;
    if (solved[key]) return false;  // already solved
    solved[key] = true;
    save(KEYS.solved, solved);
    addActivity();
    return true;  // newly solved
  }

  // Increment attempts count (regardless of correct/incorrect)
  function recordAttempt(sectionId, patternId, problemIdx) {
    const attempts = load(KEYS.attempts, {});
    const key = sectionId + ':' + patternId + ':' + problemIdx;
    attempts[key] = (attempts[key] || 0) + 1;
    save(KEYS.attempts, attempts);
  }

  // Record today's activity in the dates list
  function addActivity() {
    const dates = load(KEYS.dates, []);
    const today = todayISO();
    if (dates.indexOf(today) === -1) {
      dates.push(today);
      dates.sort();
      save(KEYS.dates, dates);
    }
  }

  // Mark a section card as 'seen' (player has opened it at least once)
  function markSeen(sectionId) {
    const seen = load(KEYS.seen, {});
    if (seen[sectionId]) return;
    seen[sectionId] = true;
    save(KEYS.seen, seen);
  }

  function isSeen(sectionId) {
    return !!load(KEYS.seen, {})[sectionId];
  }

  // Count solved problems within a section (optionally a single pattern)
  function countSolved(sectionId, patternId) {
    const solved = load(KEYS.solved, {});
    const prefix = sectionId + ':' + (patternId ? patternId + ':' : '');
    let n = 0;
    for (const k in solved) {
      if (solved[k] && k.startsWith(prefix)) n++;
    }
    return n;
  }

  function isProblemSolved(sectionId, patternId, problemIdx) {
    const solved = load(KEYS.solved, {});
    return !!solved[sectionId + ':' + patternId + ':' + problemIdx];
  }

  // Compute current consecutive-day streak
  function streak() {
    const dates = load(KEYS.dates, []);
    if (dates.length === 0) return 0;
    const today = todayISO();
    const yesterday = (function(){
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    })();
    // Player's streak only counts if active today OR yesterday (grace day)
    const hasToday = dates.indexOf(today) !== -1;
    const hasYesterday = dates.indexOf(yesterday) !== -1;
    if (!hasToday && !hasYesterday) return 0;
    // Count consecutive days backwards from the most recent active date
    const sorted = dates.slice().sort().reverse();
    let count = 1;
    let cursor = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(cursor + 'T00:00:00');
      prev.setDate(prev.getDate() - 1);
      const expected = prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0') + '-' + String(prev.getDate()).padStart(2,'0');
      if (sorted[i] === expected) {
        count++;
        cursor = sorted[i];
      } else {
        break;
      }
    }
    return count;
  }

  // Total stats across all sets
  function totalStats() {
    const solved = load(KEYS.solved, {});
    const attempts = load(KEYS.attempts, {});
    let solvedCount = 0, attemptCount = 0;
    for (const k in solved) if (solved[k]) solvedCount++;
    for (const k in attempts) attemptCount += attempts[k];
    const accuracy = attemptCount > 0 ? Math.round((solvedCount / attemptCount) * 100) : 0;
    return { solved: solvedCount, attempts: attemptCount, accuracy };
  }

  // Daily challenge: pick a deterministic-per-day unsolved problem.
  // bookData should be the loaded book-data.json content.
  function todaysDailyChallenge(bookData) {
    const today = todayISO();
    const stored = load(KEYS.daily, null);
    if (stored && stored.date === today) {
      // Already picked today
      return stored.challenge;
    }
    if (!bookData) return null;

    // Build list of all available problems (Sets 1-3, excluding Set 4 since it's
    // open-ended and Set 5 since it's user-captured)
    const pool = [];
    ['ton1','ton2','ton3'].forEach(function(sid){
      const sec = bookData[sid];
      if (!sec || !sec.patterns) return;
      sec.patterns.forEach(function(pat){
        (pat.puzzles || []).forEach(function(_, idx){
          pool.push({ sid, pid: pat.id, label: pat.label, idx });
        });
      });
    });

    if (pool.length === 0) return null;

    // Deterministic pick based on date — same problem all session, changes next day.
    // Hash the date string into an index
    let hash = 0;
    for (let i = 0; i < today.length; i++) hash = (hash * 31 + today.charCodeAt(i)) | 0;
    const idx = Math.abs(hash) % pool.length;
    const challenge = pool[idx];
    save(KEYS.daily, { date: today, challenge });
    return challenge;
  }

  // Check if today's daily challenge has been solved
  function isDailySolved() {
    const stored = load(KEYS.daily, null);
    if (!stored || stored.date !== todayISO()) return false;
    const c = stored.challenge;
    return isProblemSolved(c.sid, c.pid, c.idx);
  }

  // Reset everything (for testing or user-request)
  function reset() {
    for (const k in KEYS) localStorage.removeItem(KEYS[k]);
  }

  window.AMath = window.AMath || {};
  window.AMath.progress = {
    markSolved: markSolved,
    recordAttempt: recordAttempt,
    addActivity: addActivity,
    markSeen: markSeen,
    isSeen: isSeen,
    countSolved: countSolved,
    isProblemSolved: isProblemSolved,
    streak: streak,
    totalStats: totalStats,
    todaysDailyChallenge: todaysDailyChallenge,
    isDailySolved: isDailySolved,
    reset: reset,
    todayISO: todayISO,
  };
})();
