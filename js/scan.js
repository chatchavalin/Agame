/**
 * scan.js — Scan / Import Board page.
 *
 * Lets the user reconstruct a physical board into the app and continue it as a
 * SOLO / analysis board (no AI opponent). Import path for this slice:
 *   • Paste board code (JSON) — the chat-assisted, no-key path.
 * (Camera → Gemini fills the same model and is added in a later slice.)
 *
 * Flow:  import/edit  →  Review grid (tap any cell/rack slot to fix)  →
 *        Start Playing (solo): place from rack, Check an equation, Commit.
 *
 * Reuses: window.AMath.boardImport (core), .ui (render), .evaluator (validate),
 *         .scoring (score). All board/tile shapes match the rest of the app.
 */
(function () {
  'use strict';

  var BI = window.AMath.boardImport;
  var UI = window.AMath.ui;
  var EV = window.AMath.evaluator;
  var SC = window.AMath.scoring;
  var SIZE = 15;

  function inv() { return window.TILE_INVENTORY; }
  function invIndex() {
    var m = {}; inv().forEach(function (d) { m[d.face] = d; }); return m;
  }

  // ---- edit model -----------------------------------------------------------
  // editBoard[r][c] = { face, assigned } | null   ;  editRack = [{face,assigned}]
  var editBoard = [];
  var editRack = [];
  var mode = 'edit';           // 'edit' | 'play'
  var solo = null;             // play-mode state
  var _problemCells = {};       // "r,c" -> true, cells flagged by auto-correct

  function blankModel() {
    editBoard = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(null);
      editBoard.push(row);
    }
    editRack = [];
  }

  // ---- model → renderable board/rack objects --------------------------------
  function freshBoard() {
    // Real board has premium squares (2T/3T/2E/3E) so renderBoard draws them.
    return (window.AMath.board && window.AMath.board.createBoard)
      ? window.AMath.board.createBoard()
      : BI.emptyBoard();
  }
  function modelToBoardObj() {
    var board = freshBoard();
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var m = editBoard[r][c];
        if (m) board.cells[r][c].tile = BI.makeTile(m.face, m.assigned, inv());
      }
    }
    return board;
  }
  function modelToRackObj() {
    var tiles = [], slotMap = {};
    editRack.forEach(function (m, i) {
      if (!m) return;
      var t = BI.makeTile(m.face, m.assigned, inv());
      if (t) { tiles.push(t); slotMap[t.id] = i; }
    });
    return { owner: 'player', tiles: tiles, slotMap: slotMap };
  }

  // ---- bag + validation summary ---------------------------------------------
  function usedFaces() {
    var used = {};
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (editBoard[r][c]) { var f = editBoard[r][c].face; used[f] = (used[f] || 0) + 1; }
    editRack.forEach(function (m) { if (m) used[m.face] = (used[m.face] || 0) + 1; });
    return used;
  }

  function refreshSummary() {
    var idx = invIndex();
    var used = usedFaces();
    var totalInv = 0, totalUsed = 0, over = [];
    inv().forEach(function (d) { totalInv += d.count; });
    Object.keys(used).forEach(function (f) {
      totalUsed += used[f];
      if (idx[f] && used[f] > idx[f].count) over.push(f + ' (' + used[f] + '/' + idx[f].count + ')');
    });
    var bagLeft = totalInv - totalUsed;

    var bagEl = document.getElementById('bag-info');
    if (bagEl) {
      bagEl.textContent = 'Bag left: ' + bagLeft + '  ·  on board + rack: ' + totalUsed + ' / ' + totalInv;
      bagEl.style.color = bagLeft < 0 ? '#f87171' : '#94a3b8';
    }

    // choice/blank cells missing an assigned value
    var needAssign = 0;
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++) {
        var m = editBoard[r][c];
        if (m && (idx[m.face] && (idx[m.face].type === 'choice' || idx[m.face].type === 'blank')) && !m.assigned) needAssign++;
      }

    var msgEl = document.getElementById('validate-msg');
    if (msgEl) {
      var msgs = [];
      if (over.length) msgs.push('❌ Too many: ' + over.join(', '));
      if (bagLeft < 0) msgs.push('❌ More tiles used than exist.');
      if (needAssign) msgs.push('⚠️ ' + needAssign + ' choice/blank tile(s) need a chosen value (tap them).');
      if (!msgs.length) msgs.push('✅ Looks consistent.');
      msgEl.innerHTML = msgs.join('<br>');
      msgEl.style.color = (over.length || bagLeft < 0) ? '#f87171' : (needAssign ? '#fbbf24' : '#34d399');
    }
    var playBtn = document.getElementById('btn-start-play');
    if (playBtn) playBtn.disabled = (over.length > 0 || bagLeft < 0);
  }

  // ---- render the editor (board + rack) -------------------------------------
  function renderEditor() {
    var boardWrap = document.getElementById('board-wrap');
    var rackWrap = document.getElementById('rack-wrap');
    if (boardWrap) {
      UI.renderBoard(modelToBoardObj(), boardWrap);
      // make every cell tappable in edit mode
      boardWrap.querySelectorAll('.amath-cell').forEach(function (cellEl) {
        var r = parseInt(cellEl.dataset.row, 10);
        var c = parseInt(cellEl.dataset.col, 10);
        if (isNaN(r) || isNaN(c)) return;
        cellEl.style.cursor = 'pointer';
        if (mode === 'edit' && _problemCells[r + ',' + c]) {
          cellEl.style.outline = '3px solid #f87171';
          cellEl.style.outlineOffset = '-2px';
        }
        cellEl.addEventListener('click', function () {
          if (mode === 'edit') openCellPicker(r, c);
          else onPlayCellClick(r, c);
        });
      });
    }
    renderRackRow(rackWrap);
    refreshSummary();
  }

  function renderRackRow(rackWrap) {
    if (!rackWrap) return;
    rackWrap.innerHTML = '';
    for (var i = 0; i < BI.RACK_SIZE; i++) {
      (function (slot) {
        var m = editRack[slot];
        var cell = document.createElement('div');
        cell.className = 'rack-slot' + (m ? '' : ' empty');
        if (m) {
          cell.appendChild(faceChip(m));
        } else {
          cell.textContent = '+';
        }
        cell.addEventListener('click', function () {
          if (mode === 'edit') openRackPicker(slot);
          else onPlayRackClick(slot);
        });
        rackWrap.appendChild(cell);
      })(i);
    }
  }
  function faceChip(m) {
    var d = document.createElement('div');
    d.className = 'face-chip';
    var label = m.assigned || m.face;
    if (label === '+/-') label = '±';
    else if (label === '×/÷') label = '×÷';
    else if (label === 'BLANK') label = '▢';
    d.textContent = label;
    return d;
  }

  // ---- face picker overlay --------------------------------------------------
  function openCellPicker(r, c) {
    showPicker('Cell (' + (r + 1) + ',' + (c + 1) + ')', editBoard[r][c], function (val) {
      editBoard[r][c] = val;   // null clears
      delete _problemCells[r + ',' + c];
      renderEditor();
    }, true);
  }
  function openRackPicker(slot) {
    showPicker('Rack slot ' + (slot + 1), editRack[slot], function (val) {
      editRack[slot] = val;
      // compact trailing nulls so the rack stays tidy
      while (editRack.length && editRack[editRack.length - 1] == null) editRack.pop();
      renderEditor();
    }, false);
  }

  function showPicker(title, current, onPick, promptAssigned) {
    var idx = invIndex();
    var ov = document.createElement('div');
    ov.className = 'picker-overlay';
    var panel = document.createElement('div');
    panel.className = 'picker-panel';
    panel.innerHTML = '<div class="picker-title">' + title + '</div>';

    var grid = document.createElement('div');
    grid.className = 'picker-grid';
    // one button per distinct inventory face
    inv().forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'picker-btn';
      b.textContent = (d.face === 'BLANK') ? '▢' : (d.face === '+/-' ? '±' : (d.face === '×/÷' ? '×÷' : d.face));
      b.addEventListener('click', function () {
        if (promptAssigned && (d.type === 'choice' || d.type === 'blank')) {
          chooseAssigned(d, function (assigned) { onPick({ face: d.face, assigned: assigned }); close(); });
        } else {
          onPick({ face: d.face, assigned: null }); close();
        }
      });
      grid.appendChild(b);
    });
    panel.appendChild(grid);

    var row = document.createElement('div');
    row.className = 'picker-actions';
    var clr = document.createElement('button');
    clr.className = 'picker-clear';
    clr.textContent = 'Clear';
    clr.addEventListener('click', function () { onPick(null); close(); });
    var cancel = document.createElement('button');
    cancel.className = 'picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', close);
    row.appendChild(clr); row.appendChild(cancel);
    panel.appendChild(row);

    ov.appendChild(panel);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
  }

  function chooseAssigned(def, cb) {
    var opts;
    if (def.face === '+/-') opts = ['+', '-'];
    else if (def.face === '×/÷') opts = ['×', '÷'];
    else { // BLANK
      opts = ['=', '+', '-', '×', '÷'];
      for (var n = 0; n <= 20; n++) opts.push(String(n));
    }
    var ov = document.createElement('div');
    ov.className = 'picker-overlay';
    var panel = document.createElement('div');
    panel.className = 'picker-panel';
    panel.innerHTML = '<div class="picker-title">Choose value for ' +
      (def.face === 'BLANK' ? 'BLANK' : def.face) + '</div>';
    var grid = document.createElement('div');
    grid.className = 'picker-grid';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'picker-btn';
      b.textContent = o;
      b.addEventListener('click', function () { cb(o); if (ov.parentNode) ov.parentNode.removeChild(ov); });
      grid.appendChild(b);
    });
    panel.appendChild(grid);
    ov.appendChild(panel);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.parentNode.removeChild(ov); });
    document.body.appendChild(ov);
  }

  // Run equation-based auto-correction over the current editBoard.
  function runAutoCorrect() {
    if (!BI.autoCorrect || !window.AMath.evaluator) return null;
    var validate = function (faces) {
      var v = window.AMath.evaluator.validateEquation(faces);
      return !!(v && v.valid);
    };
    var res = BI.autoCorrect(editBoard, validate);
    _problemCells = {};
    res.problems.forEach(function (p) { _problemCells[p[0] + ',' + p[1]] = true; });
    return res;
  }

  // ---- import: from a board-code string (used by paste box AND camera) -----
  function applyImportText(text, sourceLabel) {
    var status = document.getElementById('import-status');
    var res = BI.parseBoardCode(text, inv());
    if (!res.ok) {
      if (status) { status.style.color = '#f87171'; status.innerHTML = '❌ ' + res.errors.join('<br>'); }
      return false;
    }
    var mergeEl = document.getElementById('merge-scan');
    var merge = !!(mergeEl && mergeEl.checked);

    var added = 0, kept = 0;
    if (merge) {
      // Fill only empty squares; keep tiles already on the board (and your fixes).
      res.board.forEach(function (e) {
        if (editBoard[e.r][e.c]) { kept++; return; }
        editBoard[e.r][e.c] = { face: e.f, assigned: e.a || null };
        added++;
      });
      res.rack.forEach(function (e, i) { if (!editRack[i]) editRack[i] = { face: e.f, assigned: e.a || null }; });
    } else {
      blankModel();
      res.board.forEach(function (e) { editBoard[e.r][e.c] = { face: e.f, assigned: e.a || null }; });
      res.rack.forEach(function (e, i) { editRack[i] = { face: e.f, assigned: e.a || null }; });
      added = res.board.length;
    }

    var ac = runAutoCorrect();   // sets _problemCells from equation checks

    // Flag only the surplus tiles (extras beyond the real supply), so red marks
    // the genuine problems instead of every copy.
    (res.flaggedCells || []).forEach(function (rc) { _problemCells[rc[0] + ',' + rc[1]] = true; });

    if (status) {
      status.style.color = '#34d399';
      var html = '✅ ' + (sourceLabel || 'Imported') + ': ' +
        (merge ? (added + ' new tile(s) added, ' + kept + ' kept') : (res.board.length + ' tile(s) read')) + '.';
      if (ac && ac.fixes.length) {
        html += '<br><span style="color:#38bdf8;">🔧 Auto-fixed ' + ac.fixes.length + ': ' +
          ac.fixes.map(function (f) { return '(' + (f.r + 1) + ',' + (f.c + 1) + ') ' + f.from + '→' + f.to; }).join(', ') + '</span>';
      }
      var attention = Object.keys(_problemCells).length;
      if (attention) {
        html += '<br><span style="color:#fbbf24;">⚠️ ' + attention +
          ' cell(s) outlined red need a look — tap any to fix or clear. Squares the scan missed: just tap them to fill in.</span>';
      }
      if (res.warnings.length) {
        html += '<br><span style="color:#94a3b8;font-size:11px;">' + res.warnings.slice(0, 6).join('<br>') +
          (res.warnings.length > 6 ? '<br>…' : '') + '</span>';
      }
      status.innerHTML = html;
    }
    if (mode !== 'edit') backToEdit();
    renderEditor();
    var rs = document.getElementById('review-section');
    if (rs) rs.scrollIntoView({ behavior: 'smooth' });
    return true;
  }

  function loadCode() {
    var ta = document.getElementById('code-input');
    if (ta) applyImportText(ta.value, 'Imported code');
  }

  // ---- solo play mode -------------------------------------------------------
  function startPlay() {
    var norm = {
      board: [], rack: [], turn: 'you', scores: { you: 0, ai: 0 },
    };
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (editBoard[r][c]) norm.board.push({ r: r, c: c, f: editBoard[r][c].face, a: editBoard[r][c].assigned });
    editRack.forEach(function (m) { if (m) norm.rack.push({ f: m.face, a: m.assigned }); });

    solo = BI.buildGameState(norm, inv(), { boardFactory: freshBoard, fillOpponent: false });
    solo.tentative = [];           // [{r,c,tileId}]
    solo.selected = null;          // selected rack tileId
    solo.score = 0;
    mode = 'play';
    document.getElementById('mode-edit').classList.remove('active');
    document.getElementById('mode-play').classList.add('active');
    document.getElementById('edit-controls').style.display = 'none';
    document.getElementById('play-controls').style.display = '';
    renderPlay();
  }

  function backToEdit() {
    mode = 'edit';
    document.getElementById('mode-play').classList.remove('active');
    document.getElementById('mode-edit').classList.add('active');
    document.getElementById('play-controls').style.display = 'none';
    document.getElementById('edit-controls').style.display = '';
    renderEditor();
  }

  function renderPlay() {
    var boardWrap = document.getElementById('board-wrap');
    UI.renderBoard(solo.board, boardWrap);
    boardWrap.querySelectorAll('.amath-cell').forEach(function (cellEl) {
      var r = parseInt(cellEl.dataset.row, 10), c = parseInt(cellEl.dataset.col, 10);
      if (isNaN(r) || isNaN(c)) return;
      cellEl.style.cursor = 'pointer';
      // highlight tentative
      if (solo.tentative.some(function (t) { return t.r === r && t.c === c; }))
        cellEl.style.outline = '3px solid #fbbf24';
      cellEl.addEventListener('click', function () { onPlayCellClick(r, c); });
    });
    UI.renderRack(solo.playerRack, document.getElementById('rack-wrap'), false);
    document.getElementById('rack-wrap').querySelectorAll('.amath-tile').forEach(function (el) {
      var id = el.dataset.tileId;
      if (solo.selected === id) { el.style.outline = '3px solid #fbbf24'; el.style.outlineOffset = '-2px'; }
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        solo.selected = (solo.selected === id) ? null : id;
        renderPlay();
      });
    });
    var s = document.getElementById('play-score');
    if (s) s.textContent = 'Solo score: ' + solo.score;
  }

  function onPlayRackClick() { /* handled by tile click in renderPlay */ }

  function onPlayCellClick(r, c) {
    if (mode !== 'play') return;
    // return a tentative tile
    var ti = solo.tentative.findIndex(function (t) { return t.r === r && t.c === c; });
    if (ti !== -1) {
      var rec = solo.tentative.splice(ti, 1)[0];
      solo.board.cells[r][c].tile = null;
      // put tile back to rack
      var t = rec.tile;
      solo.playerRack.tiles.push(t);
      solo.playerRack.slotMap[t.id] = solo.playerRack.tiles.length - 1;
      renderPlay();
      return;
    }
    if (solo.board.cells[r][c].tile) return; // occupied (committed)
    if (!solo.selected) return;
    // place selected rack tile here (tentative)
    var idx = solo.playerRack.tiles.findIndex(function (t) { return t.id === solo.selected; });
    if (idx === -1) return;
    var tile = solo.playerRack.tiles.splice(idx, 1)[0];
    delete solo.playerRack.slotMap[tile.id];
    solo.board.cells[r][c].tile = tile;
    solo.tentative.push({ r: r, c: c, tile: tile, tileId: tile.id });
    solo.selected = null;
    renderPlay();
  }

  function clearTentative() {
    solo.tentative.slice().forEach(function (rec) {
      solo.board.cells[rec.r][rec.c].tile = null;
      solo.playerRack.tiles.push(rec.tile);
      solo.playerRack.slotMap[rec.tile.id] = solo.playerRack.tiles.length - 1;
    });
    solo.tentative = [];
    solo.selected = null;
    renderPlay();
  }

  // Validate the single straight line formed by the tentative tiles.
  function checkPlay() {
    var msg = document.getElementById('play-msg');
    if (!solo.tentative.length) { msg.style.color = '#94a3b8'; msg.textContent = 'Place some tiles first.'; return; }
    var rows = solo.tentative.map(function (t) { return t.r; });
    var cols = solo.tentative.map(function (t) { return t.c; });
    var sameRow = rows.every(function (v) { return v === rows[0]; });
    var sameCol = cols.every(function (v) { return v === cols[0]; });
    if (!sameRow && !sameCol) { msg.style.color = '#f87171'; msg.textContent = '❌ Tiles must be in one line.'; return; }

    var faces = collectLineFaces(sameRow, sameRow ? rows[0] : cols[0]);
    if (!faces) { msg.style.color = '#f87171'; msg.textContent = '❌ Tiles must be contiguous.'; return; }
    var v = EV.validateEquation(faces);   // validateEquation takes faces directly
    if (v && v.valid) {
      msg.style.color = '#34d399';
      msg.textContent = '✅ Valid equation: ' + faces.join(' ');
    } else {
      msg.style.color = '#f87171';
      msg.textContent = '❌ ' + ((v && v.reason) || 'Not a valid equation') + ': ' + faces.join(' ');
    }
  }

  // Gather the full contiguous line (committed + tentative) along a row/col.
  function collectLineFaces(isRow, fixed) {
    // find min/max of tentative on the moving axis
    var moving = solo.tentative.map(function (t) { return isRow ? t.c : t.r; });
    var lo = Math.min.apply(null, moving), hi = Math.max.apply(null, moving);
    // extend across committed neighbours
    function cellAt(i) { return isRow ? solo.board.cells[fixed][i] : solo.board.cells[i][fixed]; }
    while (lo - 1 >= 0 && cellAt(lo - 1).tile) lo--;
    while (hi + 1 < SIZE && cellAt(hi + 1).tile) hi++;
    var faces = [];
    for (var i = lo; i <= hi; i++) {
      var cell = cellAt(i);
      if (!cell.tile) return null; // gap → not contiguous
      var t = cell.tile;
      faces.push(t.assigned || t.face);
    }
    return faces;
  }

  function commitPlay() {
    // simple commit: lock tentative, refill rack from bag, add nothing to score
    // unless the line validated. (Scoring kept manual/simple for analysis v1.)
    solo.tentative = [];
    solo.selected = null;
    var need = BI.RACK_SIZE - solo.playerRack.tiles.length;
    for (var i = 0; i < need && solo.bag.tiles.length; i++) {
      var t = solo.bag.tiles.shift();
      solo.playerRack.tiles.push(t);
      solo.playerRack.slotMap[t.id] = solo.playerRack.tiles.length - 1;
    }
    var msg = document.getElementById('play-msg');
    msg.style.color = '#94a3b8';
    msg.textContent = 'Committed. Rack refilled (' + solo.bag.tiles.length + ' left in bag).';
    renderPlay();
  }

  // ---- init -----------------------------------------------------------------
  function init() {
    blankModel();
    renderEditor();
    var byId = function (id) { return document.getElementById(id); };
    byId('btn-load-code').addEventListener('click', loadCode);
    byId('btn-clear-all').addEventListener('click', function () { blankModel(); _problemCells = {}; renderEditor(); var s = byId('import-status'); if (s) s.textContent = ''; });
    byId('btn-start-play').addEventListener('click', startPlay);
    byId('btn-back-edit').addEventListener('click', backToEdit);
    byId('btn-check').addEventListener('click', checkPlay);
    byId('btn-commit').addEventListener('click', commitPlay);
    byId('btn-clear-tent').addEventListener('click', clearTentative);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public hook for the camera/Gemini module to feed a board-code string.
  window.AMath = window.AMath || {};
  window.AMath.scanApply = applyImportText;
})();
