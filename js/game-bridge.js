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
    // Read user info from URL params (set by lobby.html when launching a game)
    var params = new URLSearchParams(window.location.search);
    _userId = params.get('userId');
    _userName = params.get('userName');
    _userPhoto = params.get('userPhoto');

    // Lobby context: no URL params, but the user IS authenticated. Pick up the
    // identity from Firebase Auth so listMyGames / getReplay work.
    if ((!_userId || _userId === 'guest') && typeof firebase !== 'undefined' && firebase.auth) {
      try {
        var current = firebase.auth().currentUser;
        if (current) {
          _userId = current.uid;
          _userName = current.displayName || '';
          _userPhoto = current.photoURL || '';
        } else {
          // Wait for auth state to settle, then re-init silently
          firebase.auth().onAuthStateChanged(function (u) {
            if (u && (!_userId || _userId === 'guest')) {
              _userId = u.uid;
              _userName = u.displayName || '';
              _userPhoto = u.photoURL || '';
              if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
                _db = firebase.firestore();
              }
            }
          });
        }
      } catch (e) { /* not a fatal — guest mode continues */ }
    }

    if (!_userId || _userId === 'guest') {
      console.log('[Bridge] Guest mode — no Firebase tracking');
      return;
    }

    console.log('[Bridge] User: ' + _userName + ' (' + _userId + ')');

    // Show profile image in game UI (no-op on lobby — element doesn't exist)
    if (_userPhoto) {
      showProfileInGame();
    }

    // Show lobby button (may not exist yet if UI hasn't rendered, or in lobby itself)
    function showLobbyBtn() {
      var lobbyBtn = document.getElementById('btn-lobby');
      if (lobbyBtn) { lobbyBtn.style.display = ''; }
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

  /**
   * Persist a full replay doc to Firestore `games` collection.
   * The doc holds the move-list + final summary so replay.html can re-play it.
   * Fire-and-forget — failure doesn't break the game.
   */
  async function saveReplay(replayDoc) {
    if (!_userId || _userId === 'guest' || !_db || !replayDoc) return null;
    try {
      var doc = Object.assign({}, replayDoc, {
        userId: _userId,
        displayName: _userName || '',
        photoURL: _userPhoto || '',
        createdAt: Date.now(),
      });
      var ref = await _db.collection('games').add(doc);
      console.log('[Bridge] Replay saved:', ref.id);
      return ref.id;
    } catch (err) {
      console.error('[Bridge] Replay save error:', err);
      return null;
    }
  }

  /**
   * Fetch the user's recent games. Returns array of { id, ...doc }.
   */
  async function listMyGames(limit) {
    if (!_userId || _userId === 'guest' || !_db) return [];
    try {
      var snap = await _db.collection('games')
        .where('userId', '==', _userId)
        .orderBy('createdAt', 'desc')
        .limit(limit || 20)
        .get();
      var games = [];
      snap.forEach(function (d) {
        games.push(Object.assign({ id: d.id }, d.data()));
      });
      return games;
    } catch (err) {
      console.error('[Bridge] listMyGames error:', err);
      return [];
    }
  }

  /**
   * Fetch one replay by id.
   */
  async function getReplay(gameId) {
    if (!_db || !gameId) return null;
    try {
      var d = await _db.collection('games').doc(gameId).get();
      if (!d.exists) return null;
      return Object.assign({ id: d.id }, d.data());
    } catch (err) {
      console.error('[Bridge] getReplay error:', err);
      return null;
    }
  }

  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // --- In-progress PvA game persistence (cross-device resume) ---------------
  // Stored as a JSON STRING on the user's own doc (Firestore can't hold the
  // board's nested arrays as structured data, and a string reuses the existing
  // users/{uid} update rule — no rules change needed). Best-effort: every path
  // is guarded so a failure never blocks gameplay or navigation.
  async function saveInProgressGame(jsonString) {
    if (!_userId || _userId === 'guest' || !_db || !jsonString) return false;
    try {
      await _db.collection('users').doc(_userId).set({
        savedPvaGameJson: jsonString,
        savedPvaGameAt: Date.now(),
      }, { merge: true });
      return true;
    } catch (e) {
      console.warn('[Bridge] saveInProgressGame failed:', e && e.message);
      return false;
    }
  }

  async function loadInProgressGame() {
    if (!_userId || _userId === 'guest' || !_db) return null;
    try {
      var snap = await _db.collection('users').doc(_userId).get();
      var data = snap && snap.exists ? snap.data() : null;
      if (!data || !data.savedPvaGameJson) return null;
      return { json: data.savedPvaGameJson, at: data.savedPvaGameAt || 0 };
    } catch (e) {
      console.warn('[Bridge] loadInProgressGame failed:', e && e.message);
      return null;
    }
  }

  async function clearInProgressGame() {
    if (!_userId || _userId === 'guest' || !_db) return;
    try {
      var FieldValue = firebase.firestore.FieldValue;
      await _db.collection('users').doc(_userId).set({
        savedPvaGameJson: FieldValue.delete(),
        savedPvaGameAt: FieldValue.delete(),
      }, { merge: true });
    } catch (e) {
      console.warn('[Bridge] clearInProgressGame failed:', e && e.message);
    }
  }

  // ── Analysis projects (cloud) — stored under users/{uid}/analysisProjects ──
  // Auto-pruned to the most recent 20.
  async function saveAnalysisProject(name, projectData) {
    if (!_userId || _userId === 'guest' || !_db || !projectData) return null;
    try {
      var col = _db.collection('users').doc(_userId).collection('analysisProjects');
      var ref = await col.add({
        name: name || ('Game ' + new Date().toISOString().slice(0, 16)),
        data: projectData,
        savedAt: Date.now(),
      });
      // Prune to last 20 (delete oldest beyond that)
      try {
        var snap = await col.orderBy('savedAt', 'desc').get();
        if (snap.size > 20) {
          var docs = snap.docs.slice(20);
          for (var i = 0; i < docs.length; i++) { await docs[i].ref.delete(); }
        }
      } catch (e) { /* pruning is best-effort */ }
      return ref.id;
    } catch (err) {
      console.warn('[Bridge] saveAnalysisProject failed:', err);
      return null;
    }
  }

  async function listAnalysisProjects(limit) {
    if (!_userId || _userId === 'guest' || !_db) return [];
    try {
      var snap = await _db.collection('users').doc(_userId)
        .collection('analysisProjects')
        .orderBy('savedAt', 'desc')
        .limit(limit || 20)
        .get();
      var out = [];
      snap.forEach(function (d) {
        var v = d.data();
        out.push({ id: d.id, name: v.name, savedAt: v.savedAt, data: v.data });
      });
      return out;
    } catch (err) {
      console.warn('[Bridge] listAnalysisProjects failed:', err);
      return [];
    }
  }

  async function deleteAnalysisProject(id) {
    if (!_userId || _userId === 'guest' || !_db || !id) return false;
    try {
      await _db.collection('users').doc(_userId)
        .collection('analysisProjects').doc(id).delete();
      return true;
    } catch (err) {
      console.warn('[Bridge] deleteAnalysisProject failed:', err);
      return false;
    }
  }

  window.AMathBridge = {
    saveGameResult: saveGameResult,
    saveReplay: saveReplay,
    listMyGames: listMyGames,
    getReplay: getReplay,
    saveInProgressGame: saveInProgressGame,
    loadInProgressGame: loadInProgressGame,
    clearInProgressGame: clearInProgressGame,
    saveAnalysisProject: saveAnalysisProject,
    listAnalysisProjects: listAnalysisProjects,
    deleteAnalysisProject: deleteAnalysisProject,
    getUserId: function () { return _userId; },
    getUserName: function () { return _userName; },
    getUserPhoto: function () { return _userPhoto; },
    isGuest: function () { return !_userId || _userId === 'guest'; },
  };
})();
