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

  function byId(id) { return document.getElementById(id); }
  function activeInv() { try { return window.TILE_INVENTORY || []; } catch (e) { return []; } }
  function validate(faces) { var v = window.AMath.evaluator.validateEquation(faces); return !!(v && v.valid); }

  // ----- scoring (tile points only) -----
  function pointsMap() { var m = {}; activeInv().forEach(function (d) { m[d.face] = d.points; }); return m; }
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
    el.className = 'gtile' + (opts.blank ? ' blank' : '');
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
      b.addEventListener('click', function () { if (rack.length < MAX) { rack.push(face); renderRack(); } });
      pad.appendChild(b);
    });
  }

  // ----- equation rendering -----
  function eqRow(faces, blankIdx) {
    var row = document.createElement('div'); row.className = 'eqrow';
    var blanks = {}; (blankIdx || []).forEach(function (x) { blanks[x] = 1; });
    var i = 0;
    while (i < faces.length) {
      if (/^[0-9]$/.test(faces[i])) {
        var g = document.createElement('div'); g.className = 'numgroup';
        while (i < faces.length && /^[0-9]$/.test(faces[i])) { g.appendChild(makeTile(faces[i], { blank: !!blanks[i] })); i++; }
        row.appendChild(g);
      } else { row.appendChild(makeTile(faces[i], { blank: !!blanks[i] })); i++; }
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
      var sols = window.AMath.bingoSolver.solve(tiles, validate, { maxSolutions: 6 });
      res.innerHTML = '';
      var label = (tiles.length === 8) ? '8-tile bingo' : ('Equation using all ' + tiles.length + ' tiles');
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 8px;">' + label + ' &nbsp;<span class="score-badge">' + base + ' pts</span></h2>';
      res.appendChild(h);
      if (sols.length) {
        var p = document.createElement('p'); p.className = 'muted';
        p.textContent = '✅ Possible (' + sols.length + (sols.capped ? '+' : '') + ' shown). Score ' + base + ' pts — tile points only, no premium squares or bingo bonus. Every arrangement scores the same:';
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
      res.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 6px;">9-tile bingo — your tiles + 1 hook</h2>';
      res.appendChild(h);
      if (!report.nine.length) {
        var no = document.createElement('p'); no.className = 'muted'; no.textContent = '❌ No hook tile makes a bingo with these tiles.';
        res.appendChild(no); return;
      }
      report.nine.forEach(function (it) { it.total = base + tilePts(it.hook, m); });
      report.nine.sort(function (a, b) { return b.total - a.total; });
      var intro = document.createElement('p'); intro.className = 'muted';
      intro.textContent = report.nine.length + ' hook tile(s) make a bingo — ranked by total score. Your tiles = ' + base + ' pts, each card adds the hook:';
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

  function runFind() { (byId('mode-select').value === '9' ? run9 : runAll)(); }

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
    renderRack(); renderKeypad();
    byId('results').innerHTML = '<p class="muted">Tap tiles to add them, then choose a mode and tap <b>Find</b>. Results show as tiles, ranked by score.</p>';
    byId('btn-find').addEventListener('click', runFind);
    byId('btn-back').addEventListener('click', function () { rack.pop(); renderRack(); });
    byId('btn-clear').addEventListener('click', function () { rack = []; renderRack(); byId('cam-status').textContent = ''; });

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
      renderKeypad(); renderRack();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
