/**
 * A-Math Game Logger
 *
 * Records all game events for debugging. Export as text to share.
 * Access via: AMath.gameLog.show() or the 📋 button
 */
(function () {
  var entries = [];
  var gameStartTime = null;
  var maxEntries = 500;

  function timestamp() {
    if (!gameStartTime) return '0:00';
    var elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function log(category, message, data) {
    var entry = {
      time: timestamp(),
      cat: category,
      msg: message,
    };
    if (data) entry.data = data;
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();
    // Also log to console for real-time debugging
    console.log('[GameLog ' + entry.time + '] [' + category + '] ' + message,
                data ? JSON.stringify(data).substring(0, 200) : '');
  }

  function startGame(info) {
    entries = [];
    gameStartTime = Date.now();
    info = info || {};
    info.codeVersion = 'v204';   // bump with each ship; confirms fresh code is loaded
    log('GAME', 'New game started', info);
  }

  function logPlay(who, placements, score, equations, extra) {
    var tiles = placements.map(function (p) {
      return (p.tile.assigned || p.tile.face) + '@(' + p.row + ',' + p.col + ')';
    }).join(' ');
    var eqStr = '';
    if (equations && equations.length > 0) {
      eqStr = equations.map(function (eq) {
        return eq.map(function (c) { return c.tile ? (c.tile.assigned || c.tile.face) : '?'; }).join('');
      }).join(' | ');
    }
    log('PLAY', who + ': ' + tiles + ' = ' + score + 'pts', {
      who: who,
      score: score,
      tiles: tiles,
      equations: eqStr,
      isBingo: placements.length === 8,
      extra: extra || null,
    });
  }

  function logSwap(who, faces) {
    log('SWAP', who + ' swapped: ' + faces.join(', '));
  }

  function logPass(who) {
    log('PASS', who + ' passed');
  }

  function logAiDecision(decision, thinkTimeMs) {
    var summary = decision.type;
    if (decision.type === 'play') {
      summary += ' ' + decision.score + 'pts (' + decision.placements.length + ' tiles)';
    }
    log('AI', 'Decision: ' + summary + ' in ' + Math.round(thinkTimeMs / 1000) + 's', {
      type: decision.type,
      score: decision.score || 0,
      tiles: decision.placements ? decision.placements.length : 0,
    });
  }

  function logUndo(undoDepth) {
    log('UNDO', 'Undone (depth ' + undoDepth + ' remaining)');
  }

  function logState(label, session) {
    if (!session) return;
    var boardTiles = 0;
    var boardRows = [];
    for (var r = 0; r < 15; r++) {
      var rowStr = [];
      for (var c = 0; c < 15; c++) {
        var t = session.board.cells[r][c].tile;
        if (t) { boardTiles++; rowStr.push(t.assigned || t.face); }
        else rowStr.push('.');
      }
      boardRows.push(rowStr.join(' '));
    }
    var pRack = session.playerRack.tiles.map(function (t) { return t.assigned || t.face; }).join(',');
    var aRack = session.aiRack.tiles.map(function (t) { return t.assigned || t.face; }).join(',');
    log('STATE', label, {
      playerScore: session.playerScore,
      aiScore: session.aiScore,
      bagSize: session.bag.tiles.length,
      boardTiles: boardTiles,
      playerRack: pRack,
      aiRack: aRack,
      consecutivePasses: session.consecutiveNonScoringTurns,
      isFirstMove: session.isFirstMove,
      board: boardRows,   // compact 15-row layout ('.'=empty) for diagnosing AI misses
    });
  }

  function logError(msg, err) {
    log('ERROR', msg, { error: err ? (err.message || String(err)) : 'unknown' });
  }

  function logCustom(msg) {
    log('INFO', msg);
  }

  function exportLog() {
    var lines = ['=== A-Math Game Log ==='];
    lines.push('Exported: ' + new Date().toISOString());
    lines.push('Entries: ' + entries.length);
    lines.push('');
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var line = '[' + e.time + '] [' + e.cat + '] ' + e.msg;
      if (e.data) {
        line += '\n    ' + JSON.stringify(e.data);
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  function show() {
    var text = exportLog();

    // Create popup
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);' +
      'z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:16px;max-width:600px;width:100%;' +
      'max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    header.innerHTML = '<span style="font-weight:bold;font-size:16px;">📋 Game Log (' + entries.length + ' entries)</span>';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px;';
    closeBtn.onclick = function () { overlay.remove(); };
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    var btnBar = document.createElement('div');
    btnBar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy to Clipboard';
    copyBtn.style.cssText = 'background:#059669;color:white;border:none;border-radius:6px;padding:8px 16px;' +
      'font-size:13px;cursor:pointer;font-weight:bold;flex:1;';
    copyBtn.onclick = function () {
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(function () { copyBtn.textContent = '📋 Copy to Clipboard'; }, 2000);
      }).catch(function () {
        // Fallback: select textarea
        textarea.select();
        document.execCommand('copy');
        copyBtn.textContent = '✅ Copied!';
        setTimeout(function () { copyBtn.textContent = '📋 Copy to Clipboard'; }, 2000);
      });
    };
    btnBar.appendChild(copyBtn);

    var downloadBtn = document.createElement('button');
    downloadBtn.textContent = '💾 Download';
    downloadBtn.style.cssText = 'background:#3b82f6;color:white;border:none;border-radius:6px;padding:8px 16px;' +
      'font-size:13px;cursor:pointer;font-weight:bold;';
    downloadBtn.onclick = function () {
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'amath-log-' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.txt';
      a.click();
      URL.revokeObjectURL(url);
    };
    btnBar.appendChild(downloadBtn);
    dialog.appendChild(btnBar);

    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = 'flex:1;min-height:200px;font-family:monospace;font-size:11px;' +
      'border:1px solid #d1d5db;border-radius:6px;padding:8px;resize:none;color:#1e293b;';
    dialog.appendChild(textarea);

    overlay.appendChild(dialog);
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  window.AMath = window.AMath || {};
  window.AMath.gameLog = {
    startGame: startGame,
    logPlay: logPlay,
    logSwap: logSwap,
    logPass: logPass,
    logAiDecision: logAiDecision,
    logUndo: logUndo,
    logState: logState,
    logError: logError,
    log: logCustom,
    exportLog: exportLog,
    show: show,
  };
})();
