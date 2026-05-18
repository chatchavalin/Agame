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
      '<div><span>You:</span> <b>' + playerScore + '</b></div>' +
      '<div><span>AI:</span> <b>' + aiScore + '</b></div>';
    dialog.appendChild(totals);

    // Table
    const table = document.createElement('table');
    table.className = 'score-sheet-table';
    table.innerHTML =
      '<thead><tr><th>#</th><th>Player</th><th>Action</th><th>Score</th></tr></thead>';
    const tbody = document.createElement('tbody');

    if (entries.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="4" style="text-align:center;color:#9ca3af">No moves yet</td>';
      tbody.appendChild(row);
    } else {
      for (const e of entries) {
        const row = document.createElement('tr');
        let actionText = e.action;
        if (e.action === 'play') {
          actionText = '+' + e.score;
          if (e.isBingo) actionText += ' BINGO 🎉';
        } else if (e.action === 'pass') {
          actionText = 'Pass';
        } else if (e.action === 'swap') {
          actionText = 'Swap';
        }
        row.innerHTML =
          '<td>' + e.turn + '</td>' +
          '<td>' + (e.who === 'player' ? 'You' : 'AI') + '</td>' +
          '<td' + (e.isBingo ? ' style="font-weight:bold;color:#059669"' : '') + '>' +
          actionText + '</td>' +
          '<td>' + e.score + '</td>';
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

  window.AMath = window.AMath || {};
  window.AMath.scoreSheet = {
    reset: reset,
    recordTurn: recordTurn,
    getAllEntries: getAllEntries,
    showPopup: showPopup,
  };
})();
