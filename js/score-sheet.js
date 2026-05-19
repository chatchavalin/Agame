/**
 * A-Math Game — Score Sheet
 *
 * Tracks history of all turns (player and AI). Shown in a popup, accessible
 * via a button. Also shown at game end.
 */

(function () {
  // Each entry: { turn, who: 'player'|'ai', action: 'play'|'pass'|'swap', score, isBingo, total }
  let entries = [];
  let turnNumber = 0;

  function reset() {
    entries = [];
    turnNumber = 0;
  }

  function recordTurn(who, action, score, isBingo, runningTotal) {
    turnNumber++;
    entries.push({
      turn: turnNumber,
      who: who,
      action: action,
      score: score || 0,
      isBingo: !!isBingo,
      total: runningTotal,
    });
  }

  function getAllEntries() {
    return entries.slice();
  }

  /**
   * Show the score sheet popup.
   * Format: 3-column (AI | Turn # | Player) — each row shows only one player's action.
   * Bingo plays shown in bold.
   */
  function showPopup(playerScore, aiScore) {
    const existing = document.querySelector('.score-sheet-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'score-sheet-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'score-sheet-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Score Sheet';
    title.className = 'score-sheet-title';
    dialog.appendChild(title);

    // Current totals
    const totals = document.createElement('div');
    totals.className = 'score-sheet-totals';
    totals.innerHTML =
      '<div><span>AI:</span> <b>' + aiScore + '</b></div>' +
      '<div><span>You:</span> <b>' + playerScore + '</b></div>';
    dialog.appendChild(totals);

    // 3-column table: AI | # | Player
    const table = document.createElement('table');
    table.className = 'score-sheet-table score-sheet-3col';
    table.innerHTML =
      '<thead><tr>' +
      '<th class="col-ai">AI</th>' +
      '<th class="col-turn">#</th>' +
      '<th class="col-player">You</th>' +
      '</tr></thead>';
    const tbody = document.createElement('tbody');

    if (entries.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="3" style="text-align:center;color:#9ca3af">No moves yet</td>';
      tbody.appendChild(row);
    } else {
      for (const e of entries) {
        const row = document.createElement('tr');
        const isPlayer = (e.who === 'player');
        const isBingo = e.isBingo;

        // Build action text
        let actionText;
        if (e.action === 'play') {
          actionText = '+' + e.score;
          if (isBingo) actionText += ' 🎉';
        } else if (e.action === 'pass') {
          actionText = 'Pass';
        } else if (e.action === 'swap') {
          actionText = 'Swap';
        } else {
          actionText = String(e.score || '');
        }

        const bingoStyle = isBingo ? ' style="font-weight:bold;color:#059669"' : '';
        const aiCell = isPlayer ? '<td class="col-ai"></td>' :
          '<td class="col-ai"' + bingoStyle + '>' + actionText + '</td>';
        const playerCell = isPlayer ?
          '<td class="col-player"' + bingoStyle + '>' + actionText + '</td>' :
          '<td class="col-player"></td>';

        row.innerHTML = aiCell + '<td class="col-turn">' + e.turn + '</td>' + playerCell;
        tbody.appendChild(row);
      }
    }
    table.appendChild(tbody);
    dialog.appendChild(table);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-primary';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '16px';
    closeBtn.addEventListener('click', () => overlay.remove());
    dialog.appendChild(closeBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  /**
   * Render a compact, live-updating score sheet into the given container.
   * Used for the desktop side panel. Shows running totals + last N turns.
   *
   * @param container DOM element to render into
   * @param playerScore current player score
   * @param aiScore current AI score
   * @param maxRows  max turn rows to display (default 30)
   */
  function renderLive(container, playerScore, aiScore, maxRows) {
    if (!container) return;
    maxRows = maxRows || 30;

    container.innerHTML = '';

    // Totals at top
    const totals = document.createElement('div');
    totals.className = 'live-score-totals';
    totals.innerHTML =
      '<span>AI: ' + (aiScore || 0) + '</span>' +
      '<span>You: ' + (playerScore || 0) + '</span>';
    container.appendChild(totals);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'live-score-empty';
      empty.textContent = 'No moves yet';
      container.appendChild(empty);
      return;
    }

    // 3-column table: AI | # | You
    const table = document.createElement('table');
    table.className = 'live-score-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th class="col-ai">AI</th>' +
      '<th class="col-turn">#</th>' +
      '<th class="col-player">You</th>' +
      '</tr></thead>';
    const tbody = document.createElement('tbody');

    // Show only the last `maxRows` entries (most recent at bottom)
    const start = Math.max(0, entries.length - maxRows);
    for (let i = start; i < entries.length; i++) {
      const e = entries[i];
      const row = document.createElement('tr');
      const isPlayer = (e.who === 'player');
      const isBingo = e.isBingo;
      if (isBingo) row.className = 'row-bingo';

      let actionText;
      if (e.action === 'play') {
        actionText = '+' + e.score;
        if (isBingo) actionText += '🎉';
      } else if (e.action === 'pass') {
        actionText = '—';
      } else if (e.action === 'swap') {
        actionText = '↻';
      } else {
        actionText = '';
      }

      const aiCell = isPlayer ? '<td class="col-ai"></td>' :
        '<td class="col-ai">' + actionText + '</td>';
      const playerCell = isPlayer ?
        '<td class="col-player">' + actionText + '</td>' :
        '<td class="col-player"></td>';

      row.innerHTML = aiCell + '<td class="col-turn">' + e.turn + '</td>' + playerCell;
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    // Auto-scroll to bottom (newest entries)
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
  }

  window.AMath = window.AMath || {};
  window.AMath.scoreSheet = {
    reset: reset,
    recordTurn: recordTurn,
    getAllEntries: getAllEntries,
    showPopup: showPopup,
    renderLive: renderLive,
  };
})();
