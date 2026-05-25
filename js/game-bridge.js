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
   * @param {object} result - { playerScore, aiScore, won, bingos, x9plays }
   */
  async function saveGameResult(result) {
    if (!_userId || _userId === 'guest' || !_db) return;

    try {
      var userRef = _db.collection('users').doc(_userId);
      var doc = await userRef.get();
      if (!doc.exists) return;

      var profile = doc.data();
      var stats = profile.stats || {};

      // Update stats
      var newStats = {
        gamesPlayed: (stats.gamesPlayed || 0) + 1,
        wins: (stats.wins || 0) + (result.won ? 1 : 0),
        losses: (stats.losses || 0) + (result.won ? 0 : 1),
        highScore: Math.max(stats.highScore || 0, result.playerScore || 0),
        totalScore: (stats.totalScore || 0) + (result.playerScore || 0),
        bingos: (stats.bingos || 0) + (result.bingos || 0),
        longestWinStreak: result.won
          ? Math.max(stats.longestWinStreak || 0, (stats.currentWinStreak || 0) + 1)
          : (stats.longestWinStreak || 0),
        currentWinStreak: result.won ? (stats.currentWinStreak || 0) + 1 : 0,
      };

      await userRef.update({ stats: newStats });
      console.log('[Bridge] Game result saved:', newStats);
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
