/**
 * A-Math Game Bridge
 * Connects game core (index.html) to Firebase.
 * Reads userId from URL params, shows profile image, saves game results.
 * 
 * Loaded in index.html AFTER game core scripts.
 */
(function () {
  'use strict';

  let _userId = null;
  let _userName = null;
  let _userPhoto = null;
  let _db = null;

  function init() {
    // Read user info from URL params (set by lobby.html)
    var params = new URLSearchParams(window.location.search);
    _userId = params.get('userId');
    _userName = params.get('userName');
    _userPhoto = params.get('userPhoto');

    if (!_userId || _userId === 'guest') {
      console.log('[Bridge] Guest mode — no Firebase tracking');
      return;
    }

    console.log('[Bridge] User: ' + _userName + ' (' + _userId + ')');

    // Show profile image in game UI
    if (_userPhoto) {
      showProfileInGame();
    }

    // Show lobby button (may not exist yet if UI hasn't rendered)
    function showLobbyBtn() {
      var lobbyBtn = document.getElementById('btn-lobby');
      if (lobbyBtn) { lobbyBtn.style.display = ''; }
      else { setTimeout(showLobbyBtn, 500); }
    }
    showLobbyBtn();

    // Wait for Firebase SDK (may load async)
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      _db = firebase.firestore();
    }
  }

  function showProfileInGame() {
    // Add small profile image next to player score
    var scoreBox = document.querySelector('.player-score');
    if (!scoreBox || scoreBox.querySelector('.game-profile-img')) return;

    var img = document.createElement('img');
    img.className = 'game-profile-img';
    img.src = _userPhoto;
    img.alt = '';
    img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid #fbbf24;margin-right:6px;vertical-align:middle;';
    scoreBox.insertBefore(img, scoreBox.firstChild);

    // Update player label with name
    var label = scoreBox.querySelector('.score-label');
    if (label && _userName) {
      label.textContent = _userName;
    }
  }

  /**
   * Call this when game ends.
   * @param {object} result - {
   *   playerScore, aiScore, won,
   *   bingos,        // bingos by this user in the game
   *   x9plays,       // ×9 plays by this user in the game
   *   maxDeficit,    // largest deficit this user was behind at any point
   *   swapCount,     // swaps by this user in the game
   *   playsMade,     // tile plays by this user in the game
   *   gameDurationMs,// game length in ms
   * }
   */
  async function saveGameResult(result) {
    if (!_userId || _userId === 'guest' || !_db) return;

    try {
      var userRef = _db.collection('users').doc(_userId);
      var doc = await userRef.get();
      if (!doc.exists) return;

      var profile = doc.data();
      var stats = profile.stats || {};
      var existingAchievements = profile.achievements || {};

      // Update stats — also accumulate the new lifetime fields.
      var newStats = {
        gamesPlayed: (stats.gamesPlayed || 0) + 1,
        wins: (stats.wins || 0) + (result.won ? 1 : 0),
        losses: (stats.losses || 0) + (result.won ? 0 : 1),
        highScore: Math.max(stats.highScore || 0, result.playerScore || 0),
        totalScore: (stats.totalScore || 0) + (result.playerScore || 0),
        bingos: (stats.bingos || 0) + (result.bingos || 0),
        x9Plays: (stats.x9Plays || 0) + (result.x9plays || 0),
        longestWinStreak: result.won
          ? Math.max(stats.longestWinStreak || 0, (stats.currentWinStreak || 0) + 1)
          : (stats.longestWinStreak || 0),
        currentWinStreak: result.won ? (stats.currentWinStreak || 0) + 1 : 0,
      };

      // Compute newly-unlocked achievements against stats AFTER this game.
      var newlyUnlocked = [];
      var achievementUpdate = {};
      if (window.AMath && window.AMath.achievements) {
        newlyUnlocked = window.AMath.achievements.computeUnlocks(
          result, newStats, existingAchievements
        );
        var now = Date.now();
        for (var i = 0; i < newlyUnlocked.length; i++) {
          achievementUpdate['achievements.' + newlyUnlocked[i]] = { unlockedAt: now };
        }
      }

      var updatePayload = { stats: newStats };
      // Merge achievement field-path updates into the same write
      for (var k in achievementUpdate) {
        if (achievementUpdate.hasOwnProperty(k)) updatePayload[k] = achievementUpdate[k];
      }

      await userRef.update(updatePayload);
      console.log('[Bridge] Game result saved:', newStats);
      if (newlyUnlocked.length > 0) {
        console.log('[Bridge] Achievements unlocked:', newlyUnlocked);
        // Stagger toasts so they don't all stack instantly
        if (window.AMath && window.AMath.achievements) {
          for (var j = 0; j < newlyUnlocked.length; j++) {
            (function (id, delay) {
              setTimeout(function () {
                window.AMath.achievements.showToast(id);
              }, delay);
            })(newlyUnlocked[j], j * 600);
          }
        }
      }
    } catch (err) {
      console.error('[Bridge] Save error:', err);
    }
  }

  // Listen for game end event from main.js
  function hookGameEnd() {
    // main.js calls window.AMathBridge.onGameEnd() when game finishes
    // This is called from the game-over handler
  }

  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AMathBridge = {
    saveGameResult: saveGameResult,
    getUserId: function () { return _userId; },
    getUserName: function () { return _userName; },
    getUserPhoto: function () { return _userPhoto; },
    isGuest: function () { return !_userId || _userId === 'guest'; },
  };
})();
