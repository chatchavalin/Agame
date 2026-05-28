/**
 * calculator.js — Bingo Calculator (calculator-style input).
 * Tap tiles on the keypad to type your rack (left→right); tap a rack tile to remove it.
 * Mode dropdown: 9-tile (8 tiles + 1 board hook) default, or 8-tile (your tiles alone).
 * Renders real A-Math tiles (square cream/amber faces, point subscripts, stacked ×/÷,
 * dashed "?" blanks). Score = tile points only (no premium squares, no bingo bonus).
 */
(function () {
  'use strict';

  var MAX = 20;   // standard rack is 8; "use all" mode allows more
  var rack = [];   // ordered face strings, length 0..MAX
  var board0 = new Array(15).fill(null);  // row-0 fixed tiles (crossing mode)
  var selCol = -1;                        // selected board column, or -1
  var inputTarget = 'rack';               // 'rack' | 'board'

  function byId(id) { return document.getElementById(id); }
  function activeInv() { try { return window.TILE_INVENTORY || []; } catch (e) { return []; } }
  function validate(faces) { var v = window.AMath.evaluator.validateEquation(faces); return !!(v && v.valid); }

  // ----- scoring (tile points only) -----
  function pointsMap() { var m = {}; activeInv().forEach(function (d) { m[d.face] = d.points; }); return m; }
  function bingoBonus() { try { return (window.AMath.constants && window.AMath.constants.BINGO_BONUS) || 40; } catch (e) { return 40; } }
  function rackSize() { try { return (window.AMath.constants && window.AMath.constants.RACK_SIZE) || 8; } catch (e) { return 8; } }
  function tilePts(face, m) {
    if (m[face] != null) return m[face];
    if (face === '×' || face === '÷') return (m['×/÷'] != null ? m['×/÷'] : 0);
    return 0;
  }
  function rackScore(tiles, m) { return tiles.reduce(function (s, f) { return s + tilePts(f, m); }, 0); }

  // ----- one A-Math tile element -----
  function makeTile(face, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'gtile' + (opts.blank ? ' blank' : '') + (opts.fixed ? ' fixed' : '');
    if (face === '+/-' || face === '×/÷') {
      el.classList.add('choice');
      var s = document.createElement('span');
      s.textContent = (face === '×/÷') ? '×/÷' : '+/−';
      el.appendChild(s);
    } else {
      var s = document.createElement('span'); s.textContent = (face === 'BLANK') ? '?' : face; el.appendChild(s);
    }
    if (opts.blank) { var q = document.createElement('span'); q.className = 'qmark'; q.textContent = '?'; el.appendChild(q); }
    if (opts.points != null) { var p = document.createElement('span'); p.className = 'pts'; p.textContent = opts.points; el.appendChild(p); }
    return el;
  }

  // faces available, by tile set, in keypad order: digits, two-digit, operators, =, blank
  function keypadFaces() {
    var inv = activeInv();
    var byType = function (t) { return inv.filter(function (d) { return d.type === t; }).map(function (d) { return d.face; }); };
    var digits = byType('digit').sort(function (a, b) { return (+a) - (+b); });
    var two = byType('twodigit').sort(function (a, b) { return (+a) - (+b); });
    var order = ['+', '-', '+/-', '×', '÷', '×/÷'];
    var ops = byType('op').concat(byType('choice')).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return digits.concat(two).concat(ops).concat(byType('equals')).concat(byType('blank'));
  }

  // ----- rack display -----
  function renderRack() {
    var wrap = byId('rack-wrap'); wrap.innerHTML = '';
    var m = pointsMap();
    var slots = Math.max(rack.length, 8);   // pad to a normal 8-rack, but grow if more
    for (var i = 0; i < slots; i++) {
      (function (idx) {
        var cell = document.createElement('div'); cell.className = 'rack-slot';
        var f = rack[idx];
        if (f != null) {
          cell.appendChild(makeTile(f, { points: tilePts(f, m) }));
          cell.addEventListener('click', function () { rack.splice(idx, 1); renderRack(); });
        } else {
          cell.classList.add('empty'); cell.textContent = '·';
        }
        wrap.appendChild(cell);
      })(i);
    }
  }

  // ----- keypad -----
  function renderKeypad() {
    var pad = byId('keypad'); pad.innerHTML = '';
    var m = pointsMap();
    keypadFaces().forEach(function (face) {
      var b = document.createElement('button'); b.className = 'key';
      b.appendChild(makeTile(face, { points: tilePts(face, m) }));
      b.addEventListener('click', function () {
        if (inputTarget === 'board' && selCol >= 0) {
          board0[selCol] = face; selCol = -1; inputTarget = 'rack'; renderBoardStrip();
        } else if (rack.length < MAX) { rack.push(face); renderRack(); }
      });
      pad.appendChild(b);
    });
  }

  // ----- equation rendering -----
  function eqRow(faces, blankIdx, fixedIdx) {
    var row = document.createElement('div'); row.className = 'eqrow';
    var blanks = {}; (blankIdx || []).forEach(function (x) { blanks[x] = 1; });
    var fixed = {}; (fixedIdx || []).forEach(function (x) { fixed[x] = 1; });
    var i = 0;
    while (i < faces.length) {
      if (/^[0-9]$/.test(faces[i])) {
        var g = document.createElement('div'); g.className = 'numgroup';
        while (i < faces.length && /^[0-9]$/.test(faces[i])) { g.appendChild(makeTile(faces[i], { blank: !!blanks[i], fixed: !!fixed[i] })); i++; }
        row.appendChild(g);
      } else { row.appendChild(makeTile(faces[i], { blank: !!blanks[i], fixed: !!fixed[i] })); i++; }
    }
    return row;
  }
  function blankNote(sol) {
    if (!sol.blankVals || !sol.blankVals.length) return null;
    var n = document.createElement('span'); n.className = 'blank-note';
    n.textContent = '? = ' + sol.blankVals.map(function (v) { return v === 'BLANK' ? '?' : v; }).join(', ');
    return n;
  }
  function eqLine(sol) {
    var line = document.createElement('div');
    line.appendChild(eqRow(sol.faces, sol.blankIdx));
    var bn = blankNote(sol); if (bn) { var w = document.createElement('div'); w.style.marginTop = '2px'; w.appendChild(bn); line.appendChild(w); }
    return line;
  }

  function currentTiles() { return rack.slice(); }

  // ----- use all tiles (8-tile bingo, or any number) -----
  function runAll() {
    var tiles = currentTiles(), res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching…' + (tiles.length > 10 ? ' (many tiles — this can take a few seconds)' : '') + '</p>';
    setTimeout(function () {
      var m = pointsMap(), base = rackScore(tiles, m);
      var bonus = (tiles.length === rackSize()) ? bingoBonus() : 0;
      var total = base + bonus;
      var sols = window.AMath.bingoSolver.solve(tiles, validate, { maxSolutions: 6 });
      res.innerHTML = '';
      var label = (tiles.length === 8) ? '8-tile bingo' : ('Equation using all ' + tiles.length + ' tiles');
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 8px;">' + label + ' &nbsp;<span class="score-badge">' + total + ' pts</span></h2>';
      res.appendChild(h);
      if (sols.length) {
        var p = document.createElement('p'); p.className = 'muted';
        var bonusTxt = bonus ? (' = ' + base + ' tile pts + ' + bonus + ' bingo bonus (all 8 tiles)') : ' (tile points only — no premium squares)';
        p.textContent = '✅ Possible (' + sols.length + (sols.capped ? '+' : '') + ' shown). Score ' + total + ' pts' + bonusTxt + '. Every arrangement scores the same:';
        res.appendChild(p);
        sols.forEach(function (s) { res.appendChild(eqLine(s)); });
      } else {
        var no = document.createElement('p'); no.className = 'muted';
        no.textContent = (sols.capped)
          ? '⏱️ Couldn’t finish searching all arrangements of ' + tiles.length + ' tiles — no equation found so far. Try fewer tiles.'
          : '❌ No equation uses all ' + tiles.length + ' tiles. Try 9-tile mode (adds one hook), or change a tile.';
        res.appendChild(no);
      }
    }, 30);
  }

  // ----- 9-tile -----
  function run9() {
    var tiles = currentTiles(), res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching every possible hook tile… (a few seconds)</p>';
    setTimeout(function () {
      var report = window.AMath.bingoSolver.bingos(tiles, validate, activeInv(), { examples: 1 });
      var m = pointsMap(), base = rackScore(tiles, m);
      var bonus = (tiles.length === rackSize()) ? bingoBonus() : 0;
      res.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 6px;">9-tile bingo — your tiles + 1 hook</h2>';
      res.appendChild(h);
      if (!report.nine.length) {
        var no = document.createElement('p'); no.className = 'muted'; no.textContent = '❌ No hook tile makes a bingo with these tiles.';
        res.appendChild(no); return;
      }
      report.nine.forEach(function (it) { it.total = base + tilePts(it.hook, m) + bonus; });
      report.nine.sort(function (a, b) { return b.total - a.total; });
      var intro = document.createElement('p'); intro.className = 'muted';
      intro.textContent = report.nine.length + ' hook tile(s) make a bingo — ranked by total score. Your tiles = ' + base + ' pts, + the hook tile, + ' + bonus + ' bingo bonus (uses all 8):';
      res.appendChild(intro);
      report.nine.forEach(function (item, idx) {
        var card = document.createElement('div'); card.className = 'hook-card';
        var rrow = document.createElement('div'); rrow.className = 'rank-row';
        var rn = document.createElement('div'); rn.className = 'rank-num' + (idx < 3 ? ' r' + (idx + 1) : ''); rn.textContent = '#' + (idx + 1);
        rrow.appendChild(rn);
        var lab = document.createElement('span'); lab.className = 'muted'; lab.textContent = 'hook'; rrow.appendChild(lab);
        rrow.appendChild(makeTile(item.hook, { points: tilePts(item.hook, m) }));
        var badge = document.createElement('span'); badge.className = 'score-badge'; badge.textContent = item.total + ' pts'; rrow.appendChild(badge);
        card.appendChild(rrow);
        item.examples.forEach(function (s) { card.appendChild(eqLine(s)); });
        res.appendChild(card);
      });
    }, 30);
  }

  // ----- board row-0 strip (crossing mode) -----
  function premiumRow0() {
    try { return window.AMath.constants.PREMIUM_SQUARES[0]; }
    catch (e) { return ['3E','','','2T','','','','3E','','','','2T','','','3E']; }
  }
  function renderBoardStrip() {
    var strip = byId('board-strip'); if (!strip) return;
    strip.innerHTML = '';
    var prem = premiumRow0(), m = pointsMap();
    for (var c = 0; c < 15; c++) {
      (function (col) {
        var cell = document.createElement('div');
        cell.className = 'bcell' + (prem[col] ? ' p' + prem[col] : '') + (col === selCol ? ' sel' : '');
        var f = board0[col];
        if (f != null) {
          cell.appendChild(makeTile(f, { points: tilePts(f, m), fixed: true }));
        } else if (prem[col]) {
          var l = document.createElement('span'); l.className = 'lbl'; l.textContent = prem[col]; cell.appendChild(l);
        }
        var n = document.createElement('span'); n.className = 'colno'; n.textContent = col; cell.appendChild(n);
        cell.addEventListener('click', function () {
          if (board0[col] != null) { board0[col] = null; selCol = col; inputTarget = 'board'; }
          else { selCol = col; inputTarget = 'board'; }
          renderBoardStrip();
        });
        strip.appendChild(cell);
      })(c);
    }
  }

  // ----- crossing bingo: best 8-tile play along row 0 -----
  function runCross() {
    var tiles = currentTiles(), res = byId('results');
    var fixed = board0.map(function (f, c) { return f != null ? { col: c, face: f } : null; }).filter(Boolean);
    if (tiles.length === 0) { res.innerHTML = '<p class="muted">Add your rack tiles first.</p>'; return; }
    if (fixed.length === 0) { res.innerHTML = '<p class="muted">Lock at least one tile on the board (row 0) so your play has something to cross.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching row 0 for the best-scoring play… (a few seconds)</p>';
    setTimeout(function () {
      var best = solveRow0(tiles, fixed);
      res.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 8px;">Tile crossing bingo (row 0)</h2>';
      res.appendChild(h);
      if (!best.length) {
        var no = document.createElement('p'); no.className = 'muted';
        no.textContent = '❌ No valid play found on row 0 using your tiles with the locked board tile(s). Try different tiles or board positions.';
        res.appendChild(no); return;
      }
      var intro = document.createElement('p'); intro.className = 'muted';
      intro.textContent = 'Best plays on row 0 — scored with premium squares' + (best[0].bonus ? ' + ' + best[0].bonus + ' bingo bonus' : '') + ', ranked by score:';
      res.appendChild(intro);
      best.forEach(function (b, idx) {
        var card = document.createElement('div'); card.className = 'hook-card';
        var rrow = document.createElement('div'); rrow.className = 'rank-row';
        var rn = document.createElement('div'); rn.className = 'rank-num' + (idx < 3 ? ' r' + (idx + 1) : ''); rn.textContent = '#' + (idx + 1);
        rrow.appendChild(rn);
        var badge = document.createElement('span'); badge.className = 'score-badge'; badge.textContent = b.score + ' pts'; rrow.appendChild(badge);
        card.appendChild(rrow);
        card.appendChild(eqRow(b.faces, b.blankIdx, b.fixedIdx));
        var pos = document.createElement('div'); pos.className = 'muted'; pos.style.marginTop = '4px';
        pos.textContent = 'Columns ' + b.start + '–' + (b.start + b.faces.length - 1) + (b.usedAll ? ' • uses all 8 rack tiles' : ' • uses ' + b.usedCount + ' rack tile(s)');
        card.appendChild(pos);
        res.appendChild(card);
      });
      if (best.truncated) {
        var t = document.createElement('p'); t.className = 'muted';
        t.textContent = '⚠️ The search was very large and stopped early, so a higher-scoring play might exist. Locking another board tile narrows the search and helps.';
        res.appendChild(t);
      }
    }, 30);
  }

  // Try placing the rack tiles into a contiguous span on row 0 that includes
  // every locked board tile at its column; validate the row-0 line; score with
  // premiums (+ bingo bonus when all 8 rack tiles are used). Returns top plays.
  function solveRow0(tiles, fixed) {
    var prem = premiumRow0(), m = pointsMap(), bonusVal = bingoBonus(), rsize = rackSize();
    var sorted = tiles.slice().sort();   // sort so identical tiles are adjacent (correct dedup)
    var minF = Math.min.apply(null, fixed.map(function (x) { return x.col; }));
    var maxF = Math.max.apply(null, fixed.map(function (x) { return x.col; }));
    var fixedMap = {}; fixed.forEach(function (x) { fixedMap[x.col] = x.face; });
    var results = [], seen = {}, truncated = false;

    for (var start = 0; start <= minF; start++) {
      for (var end = maxF; end < 15; end++) {
        var freeCols = [];
        for (var c = start; c <= end; c++) if (fixedMap[c] == null) freeCols.push(c);
        if (freeCols.length === 0) continue;            // need at least one rack tile placed
        if (freeCols.length > sorted.length) continue;  // not enough rack tiles to fill the gaps
        var r = enumerateFills(sorted, freeCols.length, function (pick) {
          var faces = [], fi = 0;
          for (var c2 = start; c2 <= end; c2++) faces.push(fixedMap[c2] != null ? fixedMap[c2] : pick[fi++]);
          if (!validate(faces)) return;
          var key = start + ':' + faces.join(',');
          if (seen[key]) return; seen[key] = true;
          var used = pick.length;
          var sc = scoreRow0(faces, start, prem, m, fixedMap);
          var bonus = (used === rsize) ? bonusVal : 0;
          var fIdx = [];
          for (var cc = start; cc <= end; cc++) if (fixedMap[cc] != null) fIdx.push(cc - start);
          results.push({ faces: faces, start: start, score: sc + bonus, bonus: bonus,
                         usedCount: used, usedAll: used === rsize, blankIdx: [], fixedIdx: fIdx });
        });
        if (r.truncated) truncated = true;
      }
    }
    results.sort(function (a, b) { return b.score - a.score; });
    var top = results.slice(0, 6);
    top.truncated = truncated;
    return top;
  }

  // Enumerate ordered selections of `k` rack tiles (resolving choice/blank faces).
  // Returns { truncated } so callers can warn when the search hit its cap.
  function enumerateFills(tiles, k, cb) {
    var BS = window.AMath.bingoSolver;
    var n = tiles.length, used = new Array(n).fill(false), pick = [], CAP = 400000, count = 0, truncated = false;
    function rec() {
      if (count > CAP) { truncated = true; return; }
      if (pick.length === k) { count++; cb(pick.slice()); return; }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        if (i > 0 && tiles[i] === tiles[i - 1] && !used[i - 1]) continue; // skip dup tiles (tiles is sorted)
        var cs = BS.choicesFor(tiles[i]);
        for (var ci = 0; ci < cs.length; ci++) {
          used[i] = true; pick.push(cs[ci]); rec(); pick.pop(); used[i] = false;
          if (count > CAP) { truncated = true; return; }
        }
      }
    }
    rec();
    return { truncated: truncated };
  }

  // Score a row-0 line with premium squares (tile + equation multipliers).
  function scoreRow0(faces, start, prem, m, fixedMap) {
    var eqMult = 1, sum = 0;
    for (var i = 0; i < faces.length; i++) {
      var col = start + i;
      var pts = tilePts(faces[i], m);
      var isNew = (fixedMap[col] == null);  // premiums apply to newly placed tiles
      var p = prem[col];
      if (isNew && p === '3T') pts *= 3;
      else if (isNew && p === '2T') pts *= 2;
      sum += pts;
      if (isNew && p === '3E') eqMult *= 3;
      else if (isNew && p === '2E') eqMult *= 2;
    }
    return sum * eqMult;
  }

  function runFind() {
    var mode = byId('mode-select').value;
    if (mode === '9') return run9();
    if (mode === 'cross') return runCross();
    return runAll();
  }

  // ----- photo of rack -----
  function onPhoto(file) {
    if (!file) return;
    var st = byId('cam-status');
    if (!window.AMath || typeof window.AMath.scanRackFromFile !== 'function') { st.textContent = 'Rack photo reader not available.'; return; }
    st.textContent = '⏳ Reading your rack…';
    window.AMath.scanRackFromFile(file).then(function (faces) {
      if (!faces || !faces.length) { st.textContent = '⚠️ Couldn’t read a rack — keep the tray in frame, tiles face-up. You can tap tiles in instead.'; return; }
      rack = [];
      faces.slice(0, MAX).forEach(function (f) {
        if (f == null || f === '') return;
        f = String(f).trim();
        if (f === '±') f = '+/-'; else if (f === '×' || f === '÷') f = '×/÷'; else if (f === '▢' || f === '?') f = 'BLANK';
        rack.push(f);
      });
      renderRack();
      st.textContent = '✅ Read ' + rack.length + ' tile(s). Check them, then Find.';
    }).catch(function (e) { st.textContent = '❌ ' + (e && e.message || 'Could not read the photo.'); });
  }

  // ----- init -----
  function init() {
    renderRack(); renderKeypad(); renderBoardStrip();
    byId('results').innerHTML = '<p class="muted">Tap tiles to add them, then choose a mode and tap <b>Find</b>. Results show as tiles, ranked by score.</p>';
    byId('btn-find').addEventListener('click', runFind);
    byId('btn-back').addEventListener('click', function () { rack.pop(); renderRack(); });
    byId('btn-clear').addEventListener('click', function () {
      rack = []; board0 = new Array(15).fill(null); selCol = -1; inputTarget = 'rack';
      renderRack(); renderBoardStrip(); byId('cam-status').textContent = '';
    });

    function syncMode() {
      var cross = byId('mode-select').value === 'cross';
      byId('board-strip-wrap').style.display = cross ? '' : 'none';
      if (!cross) { selCol = -1; inputTarget = 'rack'; }
      renderBoardStrip();
    }
    byId('mode-select').addEventListener('change', syncMode);
    syncMode();

    function wirePhoto(btnId, inputId) {
      var btn = byId(btnId), input = byId(inputId);
      if (!btn || !input) return;
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; onPhoto(f); e.target.value = ''; });
    }
    wirePhoto('calc-photo', 'calc-photo-input');   // gallery / files
    wirePhoto('calc-camera', 'calc-camera-input'); // live camera

    var tsel = byId('tileset-select');
    try { if (window.AMath && window.AMath.settings && window.AMath.settings.get) tsel.value = window.AMath.settings.get('tileSet') || 'prathom'; } catch (e) {}
    tsel.addEventListener('change', function () {
      try { window.AMath.settings.set('tileSet', tsel.value); } catch (e) {}
      renderKeypad(); renderRack(); renderBoardStrip();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
