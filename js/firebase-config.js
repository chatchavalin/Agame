/**
 * A-Math Firebase Configuration
 * Used by lobby.html for auth, profile, stats.
 * Game core (index.html) loads this via game-bridge.js.
 */
(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyCPO4CKH0RO7q1ZySkS9OMTBnU5I0qpusw",
    authDomain: "amath-52dd0.firebaseapp.com",
    projectId: "amath-52dd0",
    storageBucket: "amath-52dd0.firebasestorage.app",
    messagingSenderId: "553955164397",
    appId: "1:553955164397:web:c12f480787b57075890ce",
    measurementId: "G-F0W9005PMC"
  };

  // Initialize Firebase (compat SDK loaded via script tags)
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    window.AMathFirebase = {
      auth: firebase.auth(),
      db: firebase.firestore(),
      storage: firebase.storage(),
      config: firebaseConfig,
    };
  }
})();
