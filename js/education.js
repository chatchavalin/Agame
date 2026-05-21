/**
 * A-Math — Education Mode
 *
 * Verify popup showing best plays with existing board tiles highlighted.
 * Desktop: Best 1/2/3 buttons auto-place tiles on board.
 * Swap/pass recommendations always included.
 */
(function () {
  'use strict';

  var searchResult = null;
  var searchAborted = false;
  var verifyBtn = null;
  var popupOverlay = null;
  var currentSession = null;

  // =========================================================================
  // BACKGROUND SEARCH
  // =========================================================================

  function startBackgroundSearch(session) {
    currentSession = session;
    searchResult = { plays: [], swapAdvice: null, endgamePlan: null, status: 'searching' };
    searchAborted = false;
    ensureVerifyButton();

    runFullAnalysis(session).then(function (result) {
      if (searchAborted) return;
      searchResult = result;
      searchResult.status = 'done';
    }).catch(function (err) {
      console.error('[Education] analysis error:', err);
      if (!searchAborted) {
        searchResult = { plays: [], swapAdvice: null, endgamePlan: null, status: 'done' };
      }
    });
  }

  function stopSearch() {
    searchAborted = true;
    currentSession = null;
    hideVerifyButton();
    closePopup();
  }

  // =========================================================================
  // ANALYSIS — find best play with full equation context
  // =========================================================================

  async function runFullAnalysis(session) {
    var AI = (window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.isAvailable())
           ? window.AMath.aiWorkerClient
           : window.AMath.aiPlayer;
    var Bag = window.AMath.bag;
    var C = window.AMath.constants;
    if (!AI || !AI.decideMove) return { plays: [], swapAdvice: null, endgamePlan: null };

    // Build complete rack (including tentative tiles)
    var virtualRack = { owner: 'player', tiles: session.playerRack.tiles.slice() };
    var tentativeIds = new Set();
    if (session.tentativePlacements) {
      for (var i = 0; i < session.tentativePlacements.length; i++) {
        var tp = session.tentativePlacements[i];
        var cell = session.board.cells[tp.row][tp.col];
        if (cell && cell.tile) {
          virtualRack.tiles.push(cell.tile);
          tentativeIds.add(cell.tile.id);
        }
      }
    }

    // Clean board without tentative tiles
    var cleanBoard = { cells: [] };
    for (var r = 0; r < C.BOARD_SIZE; r++) {
      cleanBoard.cells[r] = [];
      for (var c = 0; c < C.BOARD_SIZE; c++) {
        var cl = session.board.cells[r][c];
        var t = cl.tile;
        var isTent = t && tentativeIds.has(t.id);
        cleanBoard.cells[r][c] = {
          premium: cl.premium, premiumUsed: cl.premiumUsed,
          tile: isTent ? null : (t ? { face: t.face, type: t.type, points: t.points, assigned: t.assigned, id: t.id } : null),
        };
      }
    }

    var bagSize = Bag.bagSize(session.bag);

    // Count player's actual play count so education gives bingo-aware advice.
    // First few turns should recommend bingo-or-swap, not short equations.
    var playerPlayCount = 0;
    if (window.AMath.scoreSheet) {
      var entries = window.AMath.scoreSheet.getAllEntries();
      for (var ei = 0; ei < entries.length; ei++) {
        if (entries[ei].who === 'player' && entries[ei].action === 'play') playerPlayCount++;
      }
    }

    // Build settings with hard-level override for education advice
    var eduSettings = {};
    try {
      if (window.AMath.settings && window.AMath.settings.get) {
        var S = window.AMath.settings;
        eduSettings.aiThinkSeconds = S.get('aiThinkSeconds');
        eduSettings.aiSwapBrain = S.get('aiSwapBrain');
        eduSettings.tileSet = S.get('tileSet');
        eduSettings.disableSixPassEnd = S.get('disableSixPassEnd');
      }
    } catch (e) { /* */ }
    eduSettings.botLevel = 'hard'; // always give full-strength advice

    var state = {
      board: cleanBoard, aiRack: virtualRack, bag: session.bag,
      isFirstMove: session.isFirstMove,
      playerScore: session.aiScore, aiScore: session.playerScore,
      aiActualPlayCount: playerPlayCount,
      consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
      opponentRack: session.aiRack, lastOpponentAction: null,
      _settings: eduSettings,
    };

    var result = { plays: [], swapAdvice: null, endgamePlan: null };

    try {
      var decision = await AI.decideMove(state);
      if (searchAborted) return result;

      if (decision.type === 'play') {
        // Build equation display: mark each cell as isNew or existing
        var newIds = new Set(decision.placements.map(function (p) { return p.tile ? p.tile.id : ''; }));
        var equationCells = [];
        if (decision.equations && decision.equations.length > 0) {
          // Use first equation (primary equation on the main line)
          for (var ei = 0; ei < decision.equations[0].length; ei++) {
            var ec = decision.equations[0][ei];
            equationCells.push({
              face: ec.tile ? (ec.tile.assigned || ec.tile.face) : '?',
              row: ec.row, col: ec.col,
              isNew: ec.isNew !== false,   // true if newly placed
              isExisting: ec.isNew === false, // already on board — HIGHLIGHT THIS
            });
          }
        }

        result.plays.push({
          placements: decision.placements,
          score: decision.score,
          tilesUsed: decision.placements.length,
          equationCells: equationCells,
        });
      } else if (decision.type === 'swap') {
        var swapFaces = [];
        for (var si = 0; si < (decision.tileIds || []).length; si++) {
          var tid = decision.tileIds[si];
          var ft = virtualRack.tiles.find(function (x) { return x.id === tid; });
          if (ft) swapFaces.push(ft.assigned || ft.face);
        }
        result.swapAdvice = { count: swapFaces.length, faces: swapFaces, tileIds: decision.tileIds || [] };
      } else if (decision.type === 'pass') {
        result.swapAdvice = { count: 0, faces: [], isPass: true };
      }

      // Endgame plan
      if (bagSize === 0 && decision.type === 'play') {
        var remaining = virtualRack.tiles.filter(function (t) {
          return !decision.placements.some(function (p) { return p.tile && p.tile.id === t.id; });
        });
        result.endgamePlan = {
          thisPlay: decision.placements.length + ' tiles → ' + decision.score + ' pts',
          remaining: remaining.length > 0
            ? remaining.length + ' tiles left: ' + remaining.map(function (t) { return t.face; }).join(', ')
            : null,
          emptyRack: remaining.length === 0,
        };
      }
    } catch (e) {
      console.error('[Education] AI search error:', e);
    }

    return result;
  }

  // =========================================================================
  // AUTO-PLACE (Desktop Best 1/2/3)
  // =========================================================================

  function autoPlacePlay(play) {
    if (!play || !play.placements || !currentSession) return;
    var Interactions = window.AMath.interactions;
    var Board = window.AMath.board;
    var Rack = window.AMath.rack;
    if (!Interactions || !Board || !Rack) return;

    // Step 1: Return ALL tentative tiles from board back to rack
    // (clearTentativePlacements only clears the array, doesn't move tiles)
    var tentative = currentSession.tentativePlacements || [];
    for (var t = tentative.length - 1; t >= 0; t--) {
      var tp = tentative[t];
      var tile = Board.removeTile(currentSession.board, tp.row, tp.col);
      if (tile) {
        tile.assigned = null;
        Rack.addTile(currentSession.playerRack, tile);
      }
    }
    Interactions.clearTentativePlacements();

    // Step 2: Place each tile from the suggestion
    for (var i = 0; i < play.placements.length; i++) {
      var p = play.placements[i];
      if (!p.tile) continue;

      // Find matching tile in player's rack by id
      var rackTile = currentSession.playerRack.tiles.find(function (rt) { return rt.id === p.tile.id; });
      if (!rackTile) {
        // Fallback: match by face (tile ids may differ between search and actual rack)
        rackTile = currentSession.playerRack.tiles.find(function (rt) {
          return rt.face === p.tile.face && !rt._eduUsed;
        });
      }
      if (!rackTile) continue;

      // Set assignment for blanks/choices
      if (p.assigned) rackTile.assigned = p.assigned;
      else if (p.tile.assigned) rackTile.assigned = p.tile.assigned;

      rackTile._eduUsed = true;
      Interactions.commitPlacement(rackTile.id, rackTile, p.row, p.col);
    }

    // Clean up temp flags
    currentSession.playerRack.tiles.forEach(function (rt) { delete rt._eduUsed; });

    closePopup();
  }

  /**
   * Auto-swap: execute the recommended swap for the player.
   */
  function autoSwap() {
    if (!searchResult || !searchResult.swapAdvice || !currentSession) return;
    var Interactions = window.AMath.interactions;
    var Board = window.AMath.board;
    var Rack = window.AMath.rack;
    var Bag = window.AMath.bag;
    if (!Interactions || !Board || !Rack || !Bag) return;

    closePopup();

    // Return any tentative tiles to rack first
    var tentative = currentSession.tentativePlacements || [];
    for (var t = tentative.length - 1; t >= 0; t--) {
      var tp = tentative[t];
      var tile = Board.removeTile(currentSession.board, tp.row, tp.col);
      if (tile) { tile.assigned = null; Rack.addTile(currentSession.playerRack, tile); }
    }
    Interactions.clearTentativePlacements();

    // Find matching tiles in the actual rack by face
    var facesToSwap = searchResult.swapAdvice.faces.slice();
    var idsToSwap = [];
    for (var i = 0; i < facesToSwap.length; i++) {
      var face = facesToSwap[i];
      var found = currentSession.playerRack.tiles.find(function (rt) {
        return (rt.assigned || rt.face) === face && idsToSwap.indexOf(rt.id) === -1;
      });
      if (found) idsToSwap.push(found.id);
    }

    if (idsToSwap.length === 0) return;

    // Execute swap
    var tilesToReturn = [];
    for (var j = 0; j < idsToSwap.length; j++) {
      var removed = Rack.removeTile(currentSession.playerRack, idsToSwap[j]);
      if (removed) tilesToReturn.push(removed);
    }
    Bag.returnTiles(currentSession.bag, tilesToReturn);
    Rack.refillFromBag(currentSession.playerRack, currentSession.bag);
    currentSession.consecutiveNonScoringTurns = (currentSession.consecutiveNonScoringTurns || 0) + 1;
    currentSession.lastOpponentAction = { type: 'swap', count: tilesToReturn.length };

    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.recordTurn('player', 'swap', 0, false,
        currentSession.playerScore, { swapCount: tilesToReturn.length });
    }

    Interactions.setPlayerTurn(false);
    stopSearch();
    if (window.AMath._triggerAiTurn) window.AMath._triggerAiTurn();
  }

  /**
   * Auto-pass: execute pass for the player.
   */
  function autoPass() {
    if (!currentSession) return;
    var Interactions = window.AMath.interactions;
    var Board = window.AMath.board;
    var Rack = window.AMath.rack;
    if (!Interactions || !Board || !Rack) return;

    closePopup();

    var tentative = currentSession.tentativePlacements || [];
    for (var t = tentative.length - 1; t >= 0; t--) {
      var tp = tentative[t];
      var tile = Board.removeTile(currentSession.board, tp.row, tp.col);
      if (tile) { tile.assigned = null; Rack.addTile(currentSession.playerRack, tile); }
    }
    Interactions.clearTentativePlacements();

    currentSession.consecutiveNonScoringTurns = (currentSession.consecutiveNonScoringTurns || 0) + 1;
    currentSession.lastOpponentAction = { type: 'pass' };

    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.recordTurn('player', 'pass', 0, false, currentSession.playerScore);
    }

    Interactions.setPlayerTurn(false);
    stopSearch();
    if (window.AMath._triggerAiTurn) window.AMath._triggerAiTurn();
  }

  // =========================================================================
  // VERIFY POPUP
  // =========================================================================

  function onVerifyPress() {
    if (!searchResult) {
      showPopup('<div style="text-align:center;padding:20px;font-size:14px;">📚 Analysis not started yet.<br>Wait for your turn to begin.</div>');
      return;
    }
    if (searchResult.status === 'searching') {
      showPopup('<div style="text-align:center;padding:20px;font-size:14px;">⏳ Still analyzing your rack...<br>Press Verify again in a few seconds.</div>');
      return;
    }
    showResultsPopup();
  }

  function showResultsPopup() {
    var r = searchResult;
    var html = '';

    // Best plays
    if (r.plays.length > 0) {
      for (var i = 0; i < r.plays.length; i++) {
        var play = r.plays[i];
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
        html += '<span style="font-weight:bold;color:#059669;">💡 Best #' + (i + 1) + ': ' +
                '<span style="font-size:18px;">' + play.score + ' pts</span></span>';

        // Auto-place button (works on both mobile and desktop)
        html += '<button onclick="window.AMath.education._autoPlace(' + i + ')" ' +
                'style="background:#059669;color:white;border:none;border-radius:6px;' +
                'padding:6px 12px;font-size:12px;cursor:pointer;font-weight:bold;">' +
                '▶ Place on board</button>';
        html += '</div>';

        // Show full equation with existing tiles highlighted
        if (play.equationCells && play.equationCells.length > 0) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px;">';
          for (var j = 0; j < play.equationCells.length; j++) {
            var ec = play.equationCells[j];
            var bg, border, badge;
            if (ec.isExisting) {
              // EXISTING board tile — highlight yellow
              bg = '#fbbf24'; border = '2px solid #d97706'; badge = '📌';
            } else {
              // NEW tile from player's rack
              bg = '#e0e7ff'; border = '1px solid #818cf8'; badge = '';
            }
            html += '<div style="display:inline-flex;flex-direction:column;align-items:center;' +
                    'background:' + bg + ';border:' + border + ';border-radius:6px;' +
                    'padding:4px 7px;min-width:34px;text-align:center;">' +
                    '<span style="font-weight:bold;font-size:15px;color:#1e293b;">' + ec.face + '</span>' +
                    '<span style="font-size:9px;color:#475569;">(' + ec.row + ',' + ec.col + ')</span>' +
                    (badge ? '<span style="font-size:9px;">' + badge + '</span>' : '') +
                    '</div>';
          }
          html += '</div>';
          html += '<div style="font-size:10px;color:#6b7280;margin-bottom:4px;">' +
                  '<span style="background:#fbbf24;padding:0 4px;border-radius:2px;border:1px solid #d97706;">📌</span> on board &nbsp; ' +
                  '<span style="background:#e0e7ff;padding:0 4px;border-radius:2px;border:1px solid #818cf8;">tile</span> from your rack</div>';
        }
        html += '</div>';
      }
    } else {
      html += '<div style="padding:8px;background:rgba(220,38,38,0.06);border-radius:6px;' +
              'margin-bottom:8px;color:#dc2626;font-size:13px;">' +
              '❌ No valid equations found with your rack.</div>';
    }

    // Swap/pass recommendation
    if (r.swapAdvice) {
      if (r.swapAdvice.isPass) {
        html += '<div style="margin-top:8px;padding:8px;background:rgba(107,114,128,0.08);' +
                'border-radius:6px;border:1px solid rgba(107,114,128,0.2);font-size:13px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span>⏭ <b>Recommendation: Pass</b></span>' +
                '<button onclick="window.AMath.education._autoPass()" ' +
                'style="background:#6b7280;color:white;border:none;border-radius:6px;' +
                'padding:6px 12px;font-size:12px;cursor:pointer;font-weight:bold;">▶ Do it</button>' +
                '</div>' +
                '<span style="color:#6b7280;font-size:12px;">No good plays or swaps available.</span></div>';
      } else if (r.swapAdvice.count > 0) {
        html += '<div style="margin-top:8px;padding:8px;background:rgba(217,119,6,0.08);' +
                'border-radius:6px;border:1px solid rgba(217,119,6,0.2);font-size:13px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<span>🔄 <b>Recommendation: Swap ' + r.swapAdvice.count + ' tiles</b></span>' +
                '<button onclick="window.AMath.education._autoSwap()" ' +
                'style="background:#d97706;color:white;border:none;border-radius:6px;' +
                'padding:6px 12px;font-size:12px;cursor:pointer;font-weight:bold;">▶ Do it</button>' +
                '</div>' +
                '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        for (var k = 0; k < r.swapAdvice.faces.length; k++) {
          html += '<span style="background:#fef3c7;border:1px solid #d97706;border-radius:4px;' +
                  'padding:2px 8px;font-weight:bold;font-size:14px;color:#1e293b;">' + r.swapAdvice.faces[k] + '</span>';
        }
        html += '</div></div>';
      }
    } else if (r.plays.length > 0) {
      html += '<div style="margin-top:6px;font-size:12px;color:#059669;">✅ Playing is your best option.</div>';
    }

    // Endgame plan
    if (r.endgamePlan) {
      html += '<div style="margin-top:8px;padding:8px;background:rgba(124,58,237,0.08);' +
              'border-radius:6px;border:1px solid rgba(124,58,237,0.2);font-size:13px;">' +
              '🎯 <b>Endgame Plan</b><br>This turn: ' + r.endgamePlan.thisPlay;
      if (r.endgamePlan.remaining) {
        html += '<br>After: ' + r.endgamePlan.remaining;
      }
      if (r.endgamePlan.emptyRack) {
        html += '<br><b style="color:#7c3aed;">This empties your rack → ×2 bonus! 🎉</b>';
      } else {
        html += '<br><span style="font-size:11px;color:#6b7280;">Goal: empty rack for ×2 bonus.</span>';
      }
      html += '</div>';
    }

    showPopup(html);
  }

  // =========================================================================
  // POPUP UI
  // =========================================================================

  function showPopup(contentHtml) {
    closePopup();
    popupOverlay = document.createElement('div');
    popupOverlay.id = 'education-popup-overlay';
    popupOverlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;';

    var popup = document.createElement('div');
    popup.style.cssText =
      'background:#fffdf5;color:#1e293b;' +
      'border-radius:16px;padding:20px;max-width:420px;width:100%;' +
      'max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.3);font-family:inherit;';

    popup.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<h3 style="margin:0;font-size:18px;color:#7c3aed;">📚 Move Verification</h3>' +
      '<button id="edu-popup-close" style="background:none;border:none;font-size:24px;' +
      'cursor:pointer;color:#6b7280;padding:0 4px;line-height:1;">✕</button>' +
      '</div>' + contentHtml;

    popupOverlay.appendChild(popup);
    document.body.appendChild(popupOverlay);

    document.getElementById('edu-popup-close').onclick = closePopup;
    popupOverlay.onclick = function (e) { if (e.target === popupOverlay) closePopup(); };
  }

  function closePopup() {
    if (popupOverlay) {
      if (document.contains(popupOverlay)) popupOverlay.remove();
      popupOverlay = null;
    }
  }

  // =========================================================================
  // VERIFY BUTTON
  // =========================================================================

  function ensureVerifyButton() {
    // If button exists but was removed from DOM (e.g. New Game rebuilt UI), reset it
    if (verifyBtn && !document.contains(verifyBtn)) verifyBtn = null;
    if (verifyBtn) { verifyBtn.style.display = ''; return; }
    var submitBtn = document.getElementById('btn-submit');
    if (!submitBtn) return;

    verifyBtn = document.createElement('button');
    verifyBtn.id = 'btn-verify';
    verifyBtn.className = 'btn';
    verifyBtn.innerHTML = '📚 Verify';
    verifyBtn.style.cssText =
      'background:#7c3aed;color:white;border:none;border-radius:6px;' +
      'padding:8px 14px;font-size:13px;cursor:pointer;font-weight:bold;';
    verifyBtn.onclick = onVerifyPress;
    submitBtn.parentNode.insertBefore(verifyBtn, submitBtn.nextSibling);
  }

  function hideVerifyButton() {
    if (verifyBtn) {
      if (document.contains(verifyBtn)) verifyBtn.style.display = 'none';
      else verifyBtn = null;
    }
  }

  // =========================================================================
  // EXPORTS
  // =========================================================================

  window.AMath = window.AMath || {};
  window.AMath.education = {
    startBackgroundSearch: startBackgroundSearch,
    stopSearch: stopSearch,
    onVerifyPress: onVerifyPress,
    hideVerifyButton: hideVerifyButton,
    ensureVerifyButton: ensureVerifyButton,
    _autoPlace: function (idx) {
      if (searchResult && searchResult.plays && searchResult.plays[idx]) {
        autoPlacePlay(searchResult.plays[idx]);
      }
    },
    _autoSwap: autoSwap,
    _autoPass: autoPass,
  };
})();
