/**
 * A-Math Lobby — Authentication, Profile, Stats, Leaderboard
 */
(function () {
  'use strict';

  let currentUser = null;
  let userProfile = null;
  let avatarDataUrl = null; // temp storage for upload before save

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function showError(elId, msg) {
    var el = document.getElementById(elId);
    if (el) { el.textContent = msg; el.classList.add('show'); }
    setTimeout(function () { if (el) el.classList.remove('show'); }, 5000);
  }

  // ============================================================
  // AUTH
  // ============================================================

  function loginGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(function (err) {
      showError('login-error', err.message);
    });
  }

  function loginEmail() {
    var email = document.getElementById('input-email').value.trim();
    var pass = document.getElementById('input-password').value;
    if (!email || !pass) return showError('login-error', 'Please enter email and password');
    firebase.auth().signInWithEmailAndPassword(email, pass).catch(function (err) {
      showError('login-error', err.message);
    });
  }

  function registerEmail() {
    var email = document.getElementById('input-email').value.trim();
    var pass = document.getElementById('input-password').value;
    if (!email || !pass) return showError('login-error', 'Please enter email and password');
    if (pass.length < 6) return showError('login-error', 'Password must be at least 6 characters');
    firebase.auth().createUserWithEmailAndPassword(email, pass).catch(function (err) {
      showError('login-error', err.message);
    });
  }

  function playGuest() {
    window.location.href = 'index.html';
  }

  function logout() {
    firebase.auth().signOut();
    currentUser = null;
    userProfile = null;
    showScreen('screen-login');
  }

  // Auth state listener
  function initAuth() {
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        currentUser = user;
        loadProfile(user.uid);
      } else {
        currentUser = null;
        userProfile = null;
        showScreen('screen-login');
      }
    });
  }

  // ============================================================
  // PROFILE
  // ============================================================

  function loadProfile(uid) {
    var db = firebase.firestore();
    db.collection('users').doc(uid).get().then(function (doc) {
      if (doc.exists) {
        userProfile = doc.data();
        console.log('[Lobby] Profile loaded:', userProfile.displayName);
        showLobby();
      } else {
        console.log('[Lobby] No profile found for uid:', uid);
        showProfileSetup();
      }
    }).catch(function (err) {
      console.error('[Lobby] Load profile error:', err);
      showError('login-error', 'Profile load failed: ' + (err.message || err));
      showProfileSetup();
    });
  }

  function showProfileSetup() {
    showScreen('screen-profile-setup');
    // Pre-fill from Google account if available
    if (currentUser) {
      if (currentUser.displayName) {
        document.getElementById('input-display-name').value = currentUser.displayName;
      }
      if (currentUser.photoURL) {
        document.getElementById('avatar-img').src = currentUser.photoURL;
        avatarDataUrl = currentUser.photoURL;
      }
    }
  }

  function handleAvatarUpload(event) {
    var file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      return showError('profile-error', 'Image must be under 2MB');
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      avatarDataUrl = e.target.result;
      document.getElementById('avatar-img').src = avatarDataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleEditAvatar(event) {
    var file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      return showError('edit-error', 'Image must be under 2MB');
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      avatarDataUrl = e.target.result;
      document.getElementById('edit-avatar-img').src = avatarDataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function uploadAvatar(uid, dataUrl) {
    // If it's already a URL (from Google), just return it
    if (dataUrl && dataUrl.startsWith('http')) return dataUrl;
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;

    // Resize image to small avatar (max 128x128) to keep Firestore doc small
    try {
      var resized = await resizeImage(dataUrl, 128);
      return resized; // store as data URL directly in Firestore
    } catch (err) {
      console.error('Resize error:', err);
      return dataUrl;
    }
  }

  function resizeImage(dataUrl, maxSize) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  async function saveProfile() {
    var name = document.getElementById('input-display-name').value.trim();
    if (!name) return showError('profile-error', 'Please enter a display name');
    if (!currentUser) return;

    var btn = document.querySelector('#screen-profile-setup .btn-primary');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var photoURL = null;
      try {
        photoURL = await uploadAvatar(currentUser.uid, avatarDataUrl);
      } catch (uploadErr) {
        console.error('Avatar upload failed, using direct URL:', uploadErr);
        // Fallback: use Google photo URL directly or skip
        photoURL = (avatarDataUrl && avatarDataUrl.startsWith('http')) ? avatarDataUrl : '';
      }
      var school = document.getElementById('input-school').value.trim();

      var profile = {
        displayName: name,
        photoURL: photoURL || '',
        school: school,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        stats: {
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          highScore: 0,
          totalScore: 0,
          bingos: 0,
          longestWinStreak: 0,
          currentWinStreak: 0,
        },
      };

      await firebase.firestore().collection('users').doc(currentUser.uid).set(profile);
      console.log('[Lobby] Profile saved for uid:', currentUser.uid);
      
      // Verify save succeeded by reading back
      var verify = await firebase.firestore().collection('users').doc(currentUser.uid).get();
      if (!verify.exists) {
        showError('profile-error', 'Save appeared to succeed but document not found! Check Firestore rules.');
        return;
      }
      console.log('[Lobby] Verified — profile exists in Firestore');
      
      userProfile = profile;
      showLobby();
    } catch (err) {
      console.error('Save profile error:', err);
      showError('profile-error', 'Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & Continue';
    }
  }

  function showProfile() {
    if (!userProfile) return;
    document.getElementById('edit-display-name').value = userProfile.displayName || '';
    document.getElementById('edit-school').value = userProfile.school || '';
    document.getElementById('edit-avatar-img').src = userProfile.photoURL || '';
    avatarDataUrl = userProfile.photoURL || null;
    document.getElementById('modal-profile').style.display = 'flex';
  }

  function closeProfile(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-profile').style.display = 'none';
  }

  async function updateProfile() {
    var name = document.getElementById('edit-display-name').value.trim();
    if (!name) return showError('edit-error', 'Please enter a display name');
    if (!currentUser) return;

    try {
      var photoURL = await uploadAvatar(currentUser.uid, avatarDataUrl);
      var school = document.getElementById('edit-school').value.trim();

      await firebase.firestore().collection('users').doc(currentUser.uid).update({
        displayName: name,
        photoURL: photoURL || '',
        school: school,
      });

      userProfile.displayName = name;
      userProfile.photoURL = photoURL || '';
      userProfile.school = school;

      updateLobbyHeader();
      closeProfile();
    } catch (err) {
      showError('edit-error', err.message);
    }
  }

  // ============================================================
  // LOBBY
  // ============================================================

  function showLobby() {
    showScreen('screen-lobby');
    updateLobbyHeader();
    updateStats();
    showLeaderboard('highScore');
  }

  function updateLobbyHeader() {
    if (!userProfile) return;
    document.getElementById('lobby-name').textContent = userProfile.displayName || 'Player';
    document.getElementById('lobby-school').textContent = userProfile.school || '';
    var avatar = document.getElementById('lobby-avatar');
    if (userProfile.photoURL) {
      avatar.src = userProfile.photoURL;
    } else {
      avatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23334155" width="100" height="100"/><text x="50" y="55" text-anchor="middle" font-size="40" fill="%23e2e8f0">😀</text></svg>';
    }
  }

  function updateStats() {
    if (!userProfile || !userProfile.stats) return;
    var s = userProfile.stats;
    document.getElementById('stat-games').textContent = s.gamesPlayed || 0;
    document.getElementById('stat-wins').textContent = s.wins || 0;
    document.getElementById('stat-losses').textContent = s.losses || 0;
    document.getElementById('stat-highscore').textContent = s.highScore || 0;
    renderBadgesPreview();
  }

  /**
   * Render up to 6 most-recent unlocked badges as a horizontal preview.
   * "View all" opens the modal that shows everything (locked + unlocked).
   */
  function renderBadgesPreview() {
    var preview = document.getElementById('badges-preview');
    if (!preview) return;
    var achievements = (userProfile && userProfile.achievements) || {};
    var defs = (window.AMath && window.AMath.achievements)
      ? window.AMath.achievements.DEFINITIONS
      : [];

    // Build list of unlocked, sorted by most recent unlockedAt desc
    var unlocked = [];
    for (var i = 0; i < defs.length; i++) {
      var rec = achievements[defs[i].id];
      if (rec) unlocked.push({ def: defs[i], unlockedAt: rec.unlockedAt || 0 });
    }
    unlocked.sort(function (a, b) { return b.unlockedAt - a.unlockedAt; });
    unlocked = unlocked.slice(0, 6);

    preview.innerHTML = '';
    if (unlocked.length === 0) {
      preview.innerHTML =
        '<span style="color:#64748b;font-size:12px;">No badges yet — play a game!</span>';
      return;
    }
    for (var j = 0; j < unlocked.length; j++) {
      var u = unlocked[j];
      var chip = document.createElement('span');
      chip.title = u.def.name + ' — ' + u.def.description;
      chip.style.cssText =
        'display:inline-flex;align-items:center;gap:4px;' +
        'background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1e293b;' +
        'padding:3px 8px;border-radius:14px;font-size:14px;font-weight:600;cursor:default;';
      chip.textContent = u.def.icon;
      preview.appendChild(chip);
    }
  }

  function openBadges() {
    var modal = document.getElementById('modal-badges');
    var container = document.getElementById('badges-grid-container');
    if (!modal || !container) return;
    var achievements = (userProfile && userProfile.achievements) || {};
    if (window.AMath && window.AMath.achievements) {
      window.AMath.achievements.renderBadges(container, achievements);
    }
    modal.style.display = 'flex';
  }

  function closeBadges(event) {
    // If called from overlay-click, event.target is the overlay; from button, it's the button
    if (event && event.target && event.target.id && event.target.id !== 'modal-badges') {
      // Click was inside the card (not on overlay) — only close if explicit close
    }
    var modal = document.getElementById('modal-badges');
    if (modal) modal.style.display = 'none';
  }

  // ============================================================
  // PLAY
  // ============================================================

  function playAI() {
    // Pass user ID to game via URL param
    var params = '?userId=' + (currentUser ? currentUser.uid : 'guest');
    if (userProfile) {
      params += '&userName=' + encodeURIComponent(userProfile.displayName || '');
      params += '&userPhoto=' + encodeURIComponent(userProfile.photoURL || '');
    }
    window.location.href = 'index.html' + params;
  }

  function playOnline() {
    // Coming soon
  }

  // ============================================================
  // LEADERBOARD
  // ============================================================

  function showLeaderboard(type) {
    // Update tabs
    document.querySelectorAll('.lb-tab').forEach(function (tab) {
      tab.classList.remove('active');
    });
    // Highlight active tab — find by text content since event may not exist
    var tabs = document.querySelectorAll('.lb-tab');
    tabs.forEach(function (tab) {
      if (type === 'highScore' && tab.textContent.indexOf('High Score') >= 0) tab.classList.add('active');
      if (type === 'wins' && tab.textContent.indexOf('Most Wins') >= 0) tab.classList.add('active');
    });

    var listEl = document.getElementById('leaderboard-list');
    listEl.innerHTML = '<div class="lb-loading">Loading...</div>';

    var field = type === 'wins' ? 'stats.wins' : 'stats.highScore';

    firebase.firestore().collection('users')
      .orderBy(field, 'desc')
      .limit(20)
      .get()
      .then(function (snapshot) {
        if (snapshot.empty) {
          listEl.innerHTML = '<div class="lb-empty">No players yet</div>';
          return;
        }

        var html = '';
        var rank = 0;
        snapshot.forEach(function (doc) {
          rank++;
          var d = doc.data();
          var s = d.stats || {};
          var score = type === 'wins' ? (s.wins || 0) : (s.highScore || 0);
          var rankClass = rank <= 3 ? ' lb-rank-' + rank : '';
          var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
          var photoSrc = d.photoURL || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23334155" width="100" height="100"/><text x="50" y="55" text-anchor="middle" font-size="40" fill="%23e2e8f0">😀</text></svg>';

          html += '<div class="lb-row">' +
                  '<div class="lb-rank' + rankClass + '">' + medal + '</div>' +
                  '<img class="lb-avatar" src="' + photoSrc + '" alt="">' +
                  '<div class="lb-info">' +
                    '<div class="lb-player-name">' + (d.displayName || 'Player') + '</div>' +
                    (d.school ? '<div class="lb-player-school">' + d.school + '</div>' : '') +
                  '</div>' +
                  '<div class="lb-score">' + score + '</div>' +
                  '</div>';
        });
        listEl.innerHTML = html;
      })
      .catch(function (err) {
        console.error('Leaderboard error:', err);
        listEl.innerHTML = '<div class="lb-empty">Error loading leaderboard</div>';
      });
  }

  // ============================================================
  // INIT
  // ============================================================

  document.addEventListener('DOMContentLoaded', function () {
    initAuth();
  });

  // Export
  window.AMathLobby = {
    loginGoogle: loginGoogle,
    loginEmail: loginEmail,
    registerEmail: registerEmail,
    playGuest: playGuest,
    logout: logout,
    saveProfile: saveProfile,
    showProfile: showProfile,
    closeProfile: closeProfile,
    updateProfile: updateProfile,
    handleAvatarUpload: handleAvatarUpload,
    handleEditAvatar: handleEditAvatar,
    playAI: playAI,
    playOnline: playOnline,
    showLeaderboard: showLeaderboard,
    openBadges: openBadges,
    closeBadges: closeBadges,
  };
})();
