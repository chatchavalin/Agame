/**
 * calculator.js — Bingo Calculator page.
 * Enter 8 rack tiles (tap or photo), then find:
 *   - 8-tile bingos (all tiles form one equation), and
 *   - 9-tile bingos (8 tiles + one board "hook"), ranked by total tile-point score.
 * Renders real A-Math tiles (cream/amber, point subscripts, stacked ×/÷, "?" blanks)
 * to match the main game's visual identity.
 */
(function () {
  'use strict';

  var RACK = 8;
  var rack = new Array(RACK).fill(null);   // each: face string | null
  var pickTarget = -1;

  function byId(id) { return document.getElementById(id); }
  function activeInv() { try { return window.TILE_INVENTORY || []; } catch (e) { return []; } }
  function validate(faces) { var v = window.AMath.evaluator.validateEquation(faces); return !!(v && v.valid); }

  // ----- scoring (tile points only: no premium squares, no bingo bonus) -----
  function pointsMap() { var m = {}; activeInv().forEach(function (d) { m[d.face] = d.points; }); return m; }
  function tilePts(face, m) {
    if (m[face] != null) return m[face];
    if (face === '×' || face === '÷') return (m['×/÷'] != null ? m['×/÷'] : 0);
    return 0;
  }
  function rackScore(tiles, m) { return tiles.reduce(function (s, f) { return s + tilePts(f, m); }, 0); }

  // ----- a single A-Math tile element -----
  function makeTile(face, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'gtile' + (opts.blank ? ' blank' : '');
    if (face === '+/-' || face === '×/÷') {
      el.classList.add('stacked');
      var t = document.createElement('span'); t.className = 't'; t.textContent = face === '×/÷' ? '×' : '+';
      var b = document.createElement('span'); b.className = 'b'; b.textContent = face === '×/÷' ? '÷' : '-';
      el.appendChild(t); el.appendChild(b);
    } else {
      var s = document.createElement('span');
      s.textContent = (face === 'BLANK') ? '?' : face;
      el.appendChild(s);
    }
    if (opts.blank) { var q = document.createElement('span'); q.className = 'qmark'; q.textContent = '?'; el.appendChild(q); }
    if (opts.points != null) { var p = document.createElement('span'); p.className = 'pts'; p.textContent = opts.points; el.appendChild(p); }
    return el;
  }

  // faces offered in the picker, based on the active tile set
  function pickerFaces() {
    var inv = activeInv();
    var two = inv.filter(function (d) { return d.type === 'twodigit'; }).map(function (d) { return d.face; });
    return ['0','1','2','3','4','5','6','7','8','9'].concat(two).concat(['+', '-', '+/-', '×/÷', '=', 'BLANK']);
  }

  // ----- rack -----
  function renderRack() {
    var wrap = byId('rack-wrap'); wrap.innerHTML = '';
    var m = pointsMap();
    for (var i = 0; i < RACK; i++) {
      (function (slot) {
        var cell = document.createElement('div');
        cell.className = 'rack-slot';
        var f = rack[slot];
        if (f) { cell.appendChild(makeTile(f, { points: tilePts(f, m) })); }
        else { cell.classList.add('empty'); cell.textContent = '+'; }
        cell.addEventListener('click', function () { openPicker(slot); });
        wrap.appendChild(cell);
      })(i);
    }
  }

  // ----- picker -----
  function openPicker(slot) {
    pickTarget = slot;
    byId('picker-title').textContent = 'Rack tile ' + (slot + 1);
    var grid = byId('picker-grid'); grid.innerHTML = '';
    var m = pointsMap();
    pickerFaces().forEach(function (face) {
      var b = document.createElement('button');
      b.className = 'picker-btn';
      b.appendChild(makeTile(face, { points: tilePts(face, m) }));
      b.addEventListener('click', function () { rack[pickTarget] = face; closePicker(); renderRack(); });
      grid.appendChild(b);
    });
    byId('picker-modal').classList.add('open');
  }
  function closePicker() { byId('picker-modal').classList.remove('open'); }

  // ----- render an equation as a row of tiles -----
  function eqRow(faces, blankIdx) {
    var row = document.createElement('div'); row.className = 'eqrow';
    var blanks = {}; (blankIdx || []).forEach(function (x) { blanks[x] = 1; });
    var i = 0;
    while (i < faces.length) {
      if (/^[0-9]$/.test(faces[i])) {
        var g = document.createElement('div'); g.className = 'numgroup';
        while (i < faces.length && /^[0-9]$/.test(faces[i])) { g.appendChild(makeTile(faces[i], { blank: !!blanks[i] })); i++; }
        row.appendChild(g);
      } else {
        row.appendChild(makeTile(faces[i], { blank: !!blanks[i] })); i++;
      }
    }
    return row;
  }
  function blankNote(sol) {
    if (!sol.blankVals || !sol.blankVals.length) return null;
    var n = document.createElement('span'); n.className = 'blank-note';
    n.textContent = '? = ' + sol.blankVals.map(function (v) { return v === 'BLANK' ? '?' : v; }).join(', ');
    return n;
  }

  function currentTiles() { return rack.filter(function (f) { return f; }); }

  // ----- 8-tile -----
  function run8() {
    var tiles = currentTiles(), res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some rack tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching…</p>';
    setTimeout(function () {
      var m = pointsMap(), base = rackScore(tiles, m);
      var sols = window.AMath.bingoSolver.solve(tiles, validate, { maxSolutions: 6 });
      res.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 8px;">8-tile bingo &nbsp;<span class="score-badge">' + base + ' pts</span></h2>';
      res.appendChild(h);
      if (sols.length) {
        var p = document.createElement('p'); p.className = 'muted';
        p.textContent = '✅ Possible (' + sols.length + (sols.capped ? '+' : '') + ' shown). Score ' + base + ' pts (tile points only — no premium squares or bingo bonus). All arrangements score the same since a bingo uses every tile:';
        res.appendChild(p);
        sols.forEach(function (s) {
          var line = document.createElement('div'); line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.flexWrap = 'wrap';
          line.appendChild(eqRow(s.faces, s.blankIdx));
          var bn = blankNote(s); if (bn) line.appendChild(bn);
          res.appendChild(line);
        });
        if (sols.capped) { var c = document.createElement('p'); c.className = 'muted'; c.textContent = '(search stopped early; more may exist)'; res.appendChild(c); }
      } else {
        var no = document.createElement('p'); no.className = 'muted';
        no.textContent = '❌ No bingo using all ' + tiles.length + ' tiles. Try the 9-tile option (adds one hook tile).';
        res.appendChild(no);
      }
    }, 30);
  }

  // ----- 9-tile -----
  function run9() {
    var tiles = currentTiles(), res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some rack tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching every possible hook tile… (a few seconds)</p>';
    setTimeout(function () {
      var report = window.AMath.bingoSolver.bingos(tiles, validate, activeInv(), { examples: 2 });
      var m = pointsMap(), base = rackScore(tiles, m);
      res.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2 style="font-size:15px;margin:0 0 6px;">9-tile bingo — your tiles + 1 hook</h2>';
      res.appendChild(h);
      if (!report.nine.length) {
        var no = document.createElement('p'); no.className = 'muted'; no.textContent = '❌ No hook tile makes a bingo with this rack.';
        res.appendChild(no); return;
      }
      report.nine.forEach(function (it) { it.total = base + tilePts(it.hook, m); });
      report.nine.sort(function (a, b) { return b.total - a.total; });
      var intro = document.createElement('p'); intro.className = 'muted';
      intro.textContent = report.nine.length + ' hook tile(s) make a bingo — ranked by total score (tile points only). Your tiles = ' + base + ' pts, each card adds the hook:';
      res.appendChild(intro);
      report.nine.forEach(function (item, idx) {
        var card = document.createElement('div'); card.className = 'hook-card';
        var rrow = document.createElement('div'); rrow.className = 'rank-row';
        var rn = document.createElement('div'); rn.className = 'rank-num' + (idx < 3 ? ' r' + (idx + 1) : ''); rn.textContent = (idx + 1);
        rrow.appendChild(rn);
        var hookLabel = document.createElement('span'); hookLabel.className = 'muted'; hookLabel.textContent = 'hook';
        rrow.appendChild(hookLabel);
        rrow.appendChild(makeTile(item.hook, { points: tilePts(item.hook, m) }));
        var badge = document.createElement('span'); badge.className = 'score-badge'; badge.textContent = item.total + ' pts';
        rrow.appendChild(badge);
        card.appendChild(rrow);
        item.examples.forEach(function (s) {
          var line = document.createElement('div'); line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.flexWrap = 'wrap';
          line.appendChild(eqRow(s.faces, s.blankIdx));
          var bn = blankNote(s); if (bn) line.appendChild(bn);
          card.appendChild(line);
        });
        res.appendChild(card);
      });
      if (report.capped) { var c = document.createElement('p'); c.className = 'muted'; c.textContent = '(search stopped early on some hooks; a few more may exist)'; res.appendChild(c); }
    }, 30);
  }

  // ----- photo of rack -----
  function onPhoto(file) {
    if (!file) return;
    var st = byId('cam-status');
    if (!window.AMath || typeof window.AMath.scanRackFromFile !== 'function') { st.textContent = 'Rack photo reader not available.'; return; }
    st.textContent = '⏳ Reading your rack…';
    window.AMath.scanRackFromFile(file).then(function (faces) {
      if (!faces || !faces.length) { st.textContent = '⚠️ Couldn’t read a rack — make sure the tray is in frame, tiles face-up. You can tap tiles in instead.'; return; }
      for (var i = 0; i < RACK; i++) {
        var f = faces[i];
        if (f == null || f === '') { rack[i] = null; continue; }
        f = String(f).trim();
        if (f === '±') f = '+/-';
        else if (f === '×' || f === '÷') f = '×/÷';
        else if (f === '▢' || f === '?') f = 'BLANK';
        rack[i] = f;
      }
      renderRack();
      st.textContent = '✅ Read ' + faces.length + ' tile(s). Check them, then find bingos.';
    }).catch(function (e) { st.textContent = '❌ ' + (e && e.message || 'Could not read the photo.'); });
  }

  // ----- init -----
  function init() {
    renderRack();
    byId('results').innerHTML = '<p class="muted">Add your tiles above (tap a slot or 📷 photo your rack), then tap <b>8-tile</b> or <b>9-tile bingo</b>. Results show as tiles, ranked by score.</p>';
    byId('btn-8').addEventListener('click', run8);
    byId('btn-9').addEventListener('click', run9);
    byId('btn-clear').addEventListener('click', function () {
      rack = new Array(RACK).fill(null); renderRack();
      byId('results').innerHTML = ''; byId('cam-status').textContent = '';
    });
    byId('picker-clear').addEventListener('click', function () { rack[pickTarget] = null; closePicker(); renderRack(); });
    byId('picker-cancel').addEventListener('click', closePicker);
    byId('picker-modal').addEventListener('click', function (e) { if (e.target === byId('picker-modal')) closePicker(); });

    var photoBtn = byId('btn-photo'), photoInput = byId('photo-input');
    photoBtn.addEventListener('click', function () { photoInput.click(); });
    photoInput.addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; onPhoto(f); e.target.value = ''; });

    var tsel = byId('tileset-select');
    try { if (window.AMath && window.AMath.settings && window.AMath.settings.get) tsel.value = window.AMath.settings.get('tileSet') || 'prathom'; } catch (e) {}
    tsel.addEventListener('change', function () {
      try { window.AMath.settings.set('tileSet', tsel.value); } catch (e) {}
      renderRack();   // point values / two-digit options may change
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
