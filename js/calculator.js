/**
 * calculator.js — Bingo Calculator page.
 * Lets the user enter 8 rack tiles (tap or photo), then finds:
 *   - 8-tile bingos (the 8 tiles alone form one equation), and
 *   - 9-tile bingos (8 tiles + one board "hook" tile), listing every hook face.
 * Uses window.AMath.bingoSolver + the game's evaluator.
 */
(function () {
  'use strict';

  var RACK = 8;
  var rack = new Array(RACK).fill(null);   // each: face string | null
  var pickTarget = -1;

  function byId(id) { return document.getElementById(id); }
  function activeInv() { try { return window.TILE_INVENTORY || []; } catch (e) { return []; } }
  function validate(faces) {
    var v = window.AMath.evaluator.validateEquation(faces);
    return !!(v && v.valid);
  }

  // Display label for a stored face.
  function label(face) {
    if (face === '+/-') return '±';
    if (face === '×/÷') return '×÷';
    if (face === 'BLANK') return '▢';
    return face;
  }

  // Faces offered in the picker, based on the active tile set.
  function pickerFaces() {
    var inv = activeInv();
    var twoDigit = inv.filter(function (d) { return d.type === 'twodigit'; }).map(function (d) { return d.face; });
    return ['0','1','2','3','4','5','6','7','8','9']
      .concat(twoDigit)
      .concat(['+', '-', '+/-', '×/÷', '=', 'BLANK']);
  }

  // ----- rack rendering -----
  function renderRack() {
    var wrap = byId('rack-wrap');
    wrap.innerHTML = '';
    for (var i = 0; i < RACK; i++) {
      (function (slot) {
        var cell = document.createElement('div');
        var f = rack[slot];
        cell.className = 'rack-slot' + (f ? '' : ' empty');
        if (f) {
          var chip = document.createElement('div');
          chip.className = 'chip';
          chip.textContent = label(f);
          cell.appendChild(chip);
        } else {
          cell.textContent = '+';
        }
        cell.addEventListener('click', function () { openPicker(slot); });
        wrap.appendChild(cell);
      })(i);
    }
  }

  // ----- picker -----
  function openPicker(slot) {
    pickTarget = slot;
    byId('picker-title').textContent = 'Rack tile ' + (slot + 1);
    var grid = byId('picker-grid');
    grid.innerHTML = '';
    pickerFaces().forEach(function (face) {
      var b = document.createElement('button');
      b.className = 'picker-btn';
      b.textContent = label(face);
      b.addEventListener('click', function () {
        rack[pickTarget] = face;
        closePicker();
        renderRack();
      });
      grid.appendChild(b);
    });
    byId('picker-modal').classList.add('open');
  }
  function closePicker() { byId('picker-modal').classList.remove('open'); }

  // ----- format an equation face array as a readable string -----
  function formatEq(faces) {
    var parts = [], num = '';
    faces.forEach(function (f) {
      if (/^[0-9]$/.test(f)) { num += f; }
      else { if (num) { parts.push(num); num = ''; } parts.push(f); }
    });
    if (num) parts.push(num);
    return parts.join(' ');
  }

  // ----- solving -----
  function currentTiles() { return rack.filter(function (f) { return f; }); }

  function run8() {
    var tiles = currentTiles();
    var res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some rack tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching…</p>';
    setTimeout(function () {
      var sols = window.AMath.bingoSolver.solve(tiles, validate, { maxSolutions: 6 });
      var html = '<h2 style="font-size:15px;">8-tile bingo (' + tiles.length + ' tiles)</h2>';
      if (sols.length) {
        html += '<p class="muted">✅ Yes — these tiles can form an equation:</p>';
        sols.forEach(function (s) { html += '<div class="eqline">' + formatEq(s) + '</div>'; });
        if (sols.capped) html += '<p class="muted">(search stopped early; more may exist)</p>';
      } else {
        html += '<p class="muted">❌ No bingo using all ' + tiles.length + ' tiles. Try the 9-tile option (add one hook tile).</p>';
      }
      res.innerHTML = html;
    }, 30);
  }

  function run9() {
    var tiles = currentTiles();
    var res = byId('results');
    if (tiles.length < 2) { res.innerHTML = '<p class="muted">Add some rack tiles first.</p>'; return; }
    res.innerHTML = '<p class="muted">Searching every possible hook tile… (a few seconds)</p>';
    setTimeout(function () {
      var report = window.AMath.bingoSolver.bingos(tiles, validate, activeInv(), { examples: 2 });
      var html = '<h2 style="font-size:15px;">9-tile bingo — your ' + tiles.length + ' tiles + 1 hook</h2>';
      if (report.nine.length) {
        html += '<p class="muted">✅ These board tiles let you bingo (hook → example):</p>';
        report.nine.forEach(function (item) {
          html += '<div class="hook-card"><span class="hook-face">' + label(item.hook) + '</span>';
          html += item.examples.map(function (s) { return formatEq(s); }).join('<br>');
          html += '</div>';
        });
      } else {
        html += '<p class="muted">❌ No hook tile makes a bingo with this rack.</p>';
      }
      if (report.capped) html += '<p class="muted">(search stopped early on some hooks; a few more may exist)</p>';
      res.innerHTML = html;
    }, 30);
  }

  // ----- photo of rack -----
  function onPhoto(file) {
    if (!file) return;
    var st = byId('cam-status');
    if (!window.AMath || typeof window.AMath.scanRackFromFile !== 'function') {
      st.textContent = 'Rack photo reader not available.'; return;
    }
    st.textContent = '⏳ Reading your rack…';
    window.AMath.scanRackFromFile(file).then(function (faces) {
      if (!faces || !faces.length) { st.textContent = '⚠️ Couldn’t read a rack — make sure the tray is in frame, tiles face-up. You can tap tiles in instead.'; return; }
      // Normalize via board-import alias if available (maps ×,÷,±,▢ to faces)
      for (var i = 0; i < RACK; i++) {
        var f = faces[i];
        if (f == null || f === '') { rack[i] = null; continue; }
        f = String(f).trim();
        if (f === '±') f = '+/-';
        else if (f === '×' || f === '÷') f = '×/÷';
        else if (f === '▢' || f === '?' ) f = 'BLANK';
        rack[i] = f;
      }
      renderRack();
      st.textContent = '✅ Read ' + faces.length + ' rack tile(s). Check them, then find bingos.';
    }).catch(function (e) {
      st.textContent = '❌ ' + (e && e.message || 'Could not read the photo.');
    });
  }

  // ----- init -----
  function init() {
    renderRack();
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
    photoInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; onPhoto(f); e.target.value = '';
    });

    var tsel = byId('tileset-select');
    try { if (window.AMath && window.AMath.settings && window.AMath.settings.get) tsel.value = window.AMath.settings.get('tileSet') || 'prathom'; } catch (e) {}
    tsel.addEventListener('change', function () {
      try { window.AMath.settings.set('tileSet', tsel.value); } catch (e) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
