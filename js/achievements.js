/**
 * A-Math Achievement System
 *
 * Defines achievements, computes which ones unlock from a game result + stats,
 * renders badge displays in the lobby, and shows toast popups when newly
 * unlocked.
 *
 * Achievements are stored in Firestore under each user as:
 *   users/{uid}.achievements: {
 *     <achievement_id>: { unlockedAt: <timestamp ms>, gameId?: <docId> }
 *   }
 *
 * Two unlock-condition styles:
 *   (a) per-game: checked from the just-finished game's result alone
 *       (e.g., First Bingo, Comeback King, High Roller).
 *   (b) lifetime: checked against running stats AFTER the new game is recorded
 *       (e.g., Bingo 50, Marathon 100).
 *
 * The achievement engine returns an array of newly-unlocked ids so callers
 * (game-bridge.js) can persist them and show toasts.
 */

(function () {
  'use strict';

  /**
   * Master list of achievements. Keep this list stable — once published,
   * removing an id orphans users who unlocked it. Adding new ids is fine.
   *
   * Fields:
   *   id          — stable key persisted in Firestore
   *   name        — display name (Thai + English)
   *   description — short hint shown in the badge grid
   *   icon        — emoji for the badge
   *   tier        — bronze | silver | gold (visual only)
   *   check(g, s) — returns true if the achievement should unlock now.
   *                 g = game result payload, s = lifetime stats AFTER this game
   */
  var DEFINITIONS = [
    {
      id: 'first_win',
      name: 'ก้าวแรก (First Steps)',
      description: 'ชนะเกมแรก',
      icon: '🌱',
      tier: 'bronze',
      check: function (g, s) { return g.won && s.wins === 1; },
    },
    {
      id: 'first_bingo',
      name: 'บิงโกแรก (First Bingo)',
      description: 'เล่น Bingo ครั้งแรก',
      icon: '🎉',
      tier: 'bronze',
      check: function (g, s) { return g.bingos > 0 && s.bingos === g.bingos; },
    },
    {
      id: 'bingo_10',
      name: 'นัก Bingo (Bingo Master)',
      description: 'Bingo สะสม 10 ครั้ง',
      icon: '🎯',
      tier: 'silver',
      check: function (g, s) { return s.bingos >= 10; },
    },
    {
      id: 'bingo_50',
      name: 'เจ้าแห่ง Bingo (Bingo Legend)',
      description: 'Bingo สะสม 50 ครั้ง',
      icon: '👑',
      tier: 'gold',
      check: function (g, s) { return s.bingos >= 50; },
    },
    {
      id: 'x9_master',
      name: '×9 Master',
      description: 'ทำ ×9 play สะสม 5 ครั้ง',
      icon: '⚡',
      tier: 'silver',
      check: function (g, s) { return (s.x9Plays || 0) >= 5; },
    },
    {
      id: 'comeback_king',
      name: 'ราชาแห่งการพลิกเกม (Comeback King)',
      description: 'ชนะหลังจากเคยตามอยู่ 100+ คะแนน',
      icon: '🔥',
      tier: 'gold',
      check: function (g, s) { return g.won && (g.maxDeficit || 0) >= 100; },
    },
    {
      id: 'perfectionist',
      name: 'สมบูรณ์แบบ (Perfectionist)',
      description: 'ชนะโดยไม่ต้อง swap ตลอดทั้งเกม',
      icon: '💎',
      tier: 'gold',
      check: function (g, s) { return g.won && (g.swapCount || 0) === 0 && (g.playsMade || 0) >= 4; },
    },
    {
      id: 'high_roller',
      name: 'ทำคะแนนสูง (High Roller)',
      description: 'ทำคะแนน 400+ ในเกมเดียว',
      icon: '🎰',
      tier: 'gold',
      check: function (g, s) { return (g.playerScore || 0) >= 400; },
    },
    {
      id: 'triple_crown',
      name: 'สามตุ๊กตา (Triple Crown)',
      description: 'Bingo 3 ครั้งในเกมเดียว',
      icon: '🏆',
      tier: 'gold',
      check: function (g, s) { return (g.bingos || 0) >= 3; },
    },
    {
      id: 'no_mercy',
      name: 'ไม่ปราณี (No Mercy)',
      description: 'ชนะด้วยคะแนนทิ้งห่าง 150+',
      icon: '💥',
      tier: 'silver',
      check: function (g, s) {
        return g.won && ((g.playerScore || 0) - (g.aiScore || 0)) >= 150;
      },
    },
    {
      id: 'veteran_50',
      name: 'นักรบ 50 เกม (Veteran)',
      description: 'เล่นครบ 50 เกม',
      icon: '🛡️',
      tier: 'silver',
      check: function (g, s) { return (s.gamesPlayed || 0) >= 50; },
    },
    {
      id: 'marathon_100',
      name: 'มาราธอน (Marathon)',
      description: 'เล่นครบ 100 เกม',
      icon: '🏅',
      tier: 'gold',
      check: function (g, s) { return (s.gamesPlayed || 0) >= 100; },
    },
  ];

  /**
   * Build a quick lookup map.
   */
  var BY_ID = {};
  for (var i = 0; i < DEFINITIONS.length; i++) BY_ID[DEFINITIONS[i].id] = DEFINITIONS[i];

  /**
   * Compute newly-unlocked achievements.
   *
   * @param {object} gameResult - per-game payload:
   *   {
   *     playerScore, aiScore, won,
   *     bingos,                 // bingos played by this user in the game
   *     x9plays,                // ×9 plays this game
   *     maxDeficit,             // largest deficit this user was behind at any peak
   *     swapCount,              // swaps this user did this game
   *     playsMade,              // tile plays this user made this game
   *   }
   * @param {object} statsAfter  - lifetime stats AFTER this game has been recorded
   * @param {object} existing    - map of already-unlocked achievement ids
   * @returns {Array<string>} list of newly-unlocked achievement ids
   */
  function computeUnlocks(gameResult, statsAfter, existing) {
    existing = existing || {};
    var unlocked = [];
    for (var i = 0; i < DEFINITIONS.length; i++) {
      var def = DEFINITIONS[i];
      if (existing[def.id]) continue;          // already unlocked — skip
      try {
        if (def.check(gameResult || {}, statsAfter || {})) {
          unlocked.push(def.id);
        }
      } catch (err) {
        console.error('[Achievements] check threw for ' + def.id, err);
      }
    }
    return unlocked;
  }

  /**
   * Show a toast popup for newly-unlocked achievements. Used both in-game and
   * in the lobby. Stacks multiple toasts vertically when many unlock at once.
   */
  function showToast(achievementId) {
    var def = BY_ID[achievementId];
    if (!def) return;

    var toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML =
      '<div class="ach-toast-inner">' +
        '<div class="ach-toast-icon">' + def.icon + '</div>' +
        '<div class="ach-toast-body">' +
          '<div class="ach-toast-title">🏆 ปลดล็อก!</div>' +
          '<div class="ach-toast-name">' + escapeHtml(def.name) + '</div>' +
          '<div class="ach-toast-desc">' + escapeHtml(def.description) + '</div>' +
        '</div>' +
      '</div>';

    // Inline styles (the styles.css file may not have these yet — toast must
    // render even on a stale CSS cache).
    toast.style.cssText =
      'position:fixed;right:16px;z-index:99999;' +
      'background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1e293b;' +
      'padding:14px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);' +
      'max-width:320px;font-family:inherit;' +
      'transition:transform .4s ease, opacity .4s ease;' +
      'transform:translateX(120%);opacity:0;';

    // Stack from the bottom — calculate Y from already-visible toasts
    var existingToasts = document.querySelectorAll('.achievement-toast');
    var offset = 16 + existingToasts.length * 86;
    toast.style.bottom = offset + 'px';

    document.body.appendChild(toast);
    // Slide in next frame
    requestAnimationFrame(function () {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
    // Auto-dismiss
    setTimeout(function () {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 500);
    }, 4500);
  }

  /**
   * Render the badge grid for a profile. Locked achievements appear faded with
   * a lock icon; unlocked ones show their real icon and unlock timestamp.
   *
   * @param {HTMLElement} container - where to render
   * @param {object} userAchievements - map { id: { unlockedAt } } from Firestore
   */
  function renderBadges(container, userAchievements) {
    if (!container) return;
    userAchievements = userAchievements || {};
    container.innerHTML = '';

    var grid = document.createElement('div');
    grid.className = 'ach-grid';
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));' +
      'gap:10px;padding:8px 0;';

    for (var i = 0; i < DEFINITIONS.length; i++) {
      var def = DEFINITIONS[i];
      var unlocked = !!userAchievements[def.id];

      var card = document.createElement('div');
      card.className = 'ach-card ' + (unlocked ? 'ach-unlocked' : 'ach-locked');
      card.style.cssText =
        'background:' + (unlocked ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : '#1e293b') + ';' +
        'color:' + (unlocked ? '#1e293b' : '#64748b') + ';' +
        'padding:12px 8px;border-radius:10px;text-align:center;' +
        'border:1px solid ' + (unlocked ? '#fbbf24' : '#334155') + ';' +
        (unlocked ? '' : 'opacity:0.6;');

      var icon = unlocked ? def.icon : '🔒';
      card.innerHTML =
        '<div style="font-size:28px;line-height:1;margin-bottom:6px;">' + icon + '</div>' +
        '<div style="font-size:11px;font-weight:600;line-height:1.2;margin-bottom:4px;">' +
          escapeHtml(def.name) + '</div>' +
        '<div style="font-size:9px;opacity:0.85;line-height:1.2;">' +
          escapeHtml(def.description) + '</div>';

      // Tooltip on hover (lobby is desktop-friendly)
      card.title = def.description + (unlocked && userAchievements[def.id].unlockedAt
        ? '\nUnlocked: ' + new Date(userAchievements[def.id].unlockedAt).toLocaleDateString()
        : '');

      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.AMath = window.AMath || {};
  window.AMath.achievements = {
    DEFINITIONS: DEFINITIONS,
    BY_ID: BY_ID,
    computeUnlocks: computeUnlocks,
    showToast: showToast,
    renderBadges: renderBadges,
  };
})();
