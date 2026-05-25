/**
 * A-Math 2P Online Room
 *
 * Firestore-backed realtime sync for two players. Architecture:
 *   - HOST creates a room with a random 6-char code and seeds initial game state
 *     (board=empty, bags, racks for both players).
 *   - GUEST joins by typing the code; their uid is written into the room doc.
 *   - Both players subscribe to onSnapshot(roomDoc). Every move is appended to
 *     the doc's `moves[]` array; the latest doc IS the canonical state.
 *
 * Schema rooms/{code}:
 *   {
 *     hostUid, hostName, hostPhoto,
 *     guestUid?, guestName?, guestPhoto?,
 *     tileSet: 'prathom' | 'mathayom',
 *     status: 'waiting' | 'playing' | 'finished',
 *     bagSeed: [tile faces in shuffle order] - host-generated, shared
 *     hostRack: [tile face ids],          // last known
 *     guestRack: [...],
 *     boardTiles: [{r,c,f,p,ty,a?}],      // committed tiles only
 *     hostScore, guestScore,
 *     turn: 'host' | 'guest',
 *     consecutiveNonScoring: 0,
 *     lastMove: {type, who, score, placements?, equations?},
 *     winner?: 'host' | 'guest' | 'tie',
 *     createdAt, lastActivity,
 *   }
 *
 * MVP scope: no chat, no rematch flow, no graceful disconnect handling beyond
 * "user just refreshes". Disconnections will eventually time out via
 * lastActivity polling on the lobby side.
 */

(function () {
  'use strict';

  function rand6() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    var code = '';
    for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  /**
   * Create a new room as host. Returns the room code.
   * Tries up to 5 times if code collides.
   */
  async function createRoom(opts) {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      throw new Error('Firebase not loaded');
    }
    var auth = firebase.auth();
    var user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    var db = firebase.firestore();
    var hostName = opts && opts.hostName || user.displayName || 'Host';
    var hostPhoto = opts && opts.hostPhoto || user.photoURL || '';
    var tileSet = (opts && opts.tileSet) || 'prathom';

    for (var attempt = 0; attempt < 5; attempt++) {
      var code = rand6();
      var ref = db.collection('rooms').doc(code);
      try {
        var existing = await ref.get();
        if (existing.exists) continue; // collision
        await ref.set({
          hostUid: user.uid,
          hostName: hostName,
          hostPhoto: hostPhoto,
          guestUid: null,
          tileSet: tileSet,
          status: 'waiting',
          createdAt: Date.now(),
          lastActivity: Date.now(),
        });
        return code;
      } catch (err) {
        console.error('[OnlineRoom] createRoom attempt', attempt, 'failed', err);
      }
    }
    throw new Error('Failed to create room after 5 attempts');
  }

  /**
   * Guest joins an existing room. Returns the room doc data, or throws if room
   * is missing / full / not waiting.
   */
  async function joinRoom(code, opts) {
    if (typeof firebase === 'undefined') throw new Error('Firebase not loaded');
    var auth = firebase.auth();
    var user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    code = (code || '').toUpperCase().trim();
    if (code.length !== 6) throw new Error('Invalid room code');

    var db = firebase.firestore();
    var ref = db.collection('rooms').doc(code);
    var snap = await ref.get();
    if (!snap.exists) throw new Error('Room not found');
    var data = snap.data();
    if (data.guestUid && data.guestUid !== user.uid) {
      throw new Error('Room is full');
    }
    if (data.hostUid === user.uid) {
      throw new Error("Can't join your own room");
    }

    var guestName = opts && opts.guestName || user.displayName || 'Guest';
    var guestPhoto = opts && opts.guestPhoto || user.photoURL || '';
    await ref.update({
      guestUid: user.uid,
      guestName: guestName,
      guestPhoto: guestPhoto,
      lastActivity: Date.now(),
    });
    return Object.assign({ id: code }, data, {
      guestUid: user.uid, guestName: guestName, guestPhoto: guestPhoto,
    });
  }

  /**
   * Subscribe to live changes on a room. Returns an unsubscribe function.
   *
   * @param {string} code
   * @param {(data: object) => void} onUpdate fired on every doc change
   * @param {(err: Error) => void}    onError
   */
  function subscribe(code, onUpdate, onError) {
    var db = firebase.firestore();
    return db.collection('rooms').doc(code).onSnapshot(
      function (snap) {
        if (!snap.exists) {
          onError && onError(new Error('Room deleted'));
          return;
        }
        onUpdate && onUpdate(Object.assign({ id: snap.id }, snap.data()));
      },
      function (err) { onError && onError(err); }
    );
  }

  /**
   * Atomically update the room doc with a partial change.
   * The caller is responsible for not stomping concurrent updates — for an MVP
   * we accept "last write wins" since turns alternate.
   */
  async function updateRoom(code, partial) {
    var db = firebase.firestore();
    var payload = Object.assign({}, partial, { lastActivity: Date.now() });
    await db.collection('rooms').doc(code).update(payload);
  }

  window.AMath = window.AMath || {};
  window.AMath.onlineRoom = {
    createRoom: createRoom,
    joinRoom: joinRoom,
    subscribe: subscribe,
    updateRoom: updateRoom,
  };
})();
