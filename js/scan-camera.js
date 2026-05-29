/**
 * scan-camera.js — Entry A for the Scan/Import feature: photograph the board
 * and have Google Gemini read it into our board-code, then hand it to
 * window.AMath.scanApply() (defined in scan.js).
 *
 * Free path: the user pastes their own free Gemini API key (from
 * aistudio.google.com/apikey). The key is stored ONLY in this device's
 * localStorage and sent straight to Google — nothing touches our servers.
 *
 * REST format confirmed from ai.google.dev/gemini-api/docs/image-understanding
 * (updated 2026-05-18):
 *   POST .../v1beta/models/gemini-3.5-flash:generateContent
 *   header: x-goog-api-key
 *   body: { contents:[{ parts:[ {inline_data:{mime_type,data}}, {text} ] }],
 *           generationConfig:{ responseMimeType:'application/json' } }
 *   reply: candidates[0].content.parts[].text
 */
(function () {
  'use strict';

  var KEY_LS = 'amath_gemini_key';
  var MODEL = 'gemini-3.5-flash';
  var ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  var MAX_DIM = 2200;   // cap longest side; large enough to keep small tiles legible

  function getKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } }
  function saveKey(k) { try { localStorage.setItem(KEY_LS, k); } catch (e) {} }

  function status(msg, color) {
    var el = document.getElementById('camera-status');
    if (el) { el.innerHTML = msg; el.style.color = color || '#94a3b8'; }
  }

  // ---- downscale a chosen image file to a base64 JPEG -----------------------
  function fileToBase64(file, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_DIM / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        try {
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          cb(dataUrl.split(',')[1]); // strip "data:image/jpeg;base64,"
        } catch (err) { cb(null); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ---- prompt: read the board into our exact board-code vocabulary ----------
  function activeInventory() {
    try { if (window.TILE_INVENTORY && window.TILE_INVENTORY.length) return window.TILE_INVENTORY; } catch (e) {}
    return null;
  }
  function tileSetName() {
    var t = 'prathom';
    try { if (window.AMath && window.AMath.settings && window.AMath.settings.get) t = window.AMath.settings.get('tileSet') || 'prathom'; } catch (e) {}
    return t === 'mathayom' ? 'Mathayom (Secondary, 100-tile)' : 'Prathom (Elementary, 70-tile)';
  }
  function buildPrompt() {
    var inv = activeInventory();
    var twoDigits = inv ? inv.filter(function (d) { return d.type === 'twodigit'; }).map(function (d) { return d.face; })
                        : ['10', '11', '12', '13', '14', '15', '16', '20'];
    var missing = ['17', '18', '19'].filter(function (f) { return twoDigits.indexOf(f) === -1; });
    var twoDigitNote = missing.length
      ? 'Two-digit tiles in THIS set are only: ' + twoDigits.join(', ') + '. Tiles ' + missing.join(',') + ' do NOT exist in this set.'
      : 'Two-digit tiles in THIS set: ' + twoDigits.join(', ') + ' (all of 10–20 exist).';
    var countsLine = inv
      ? 'Exact tile supply for this set — you cannot see more than these of any face: ' +
        inv.map(function (d) { return '"' + d.face + '"×' + d.count; }).join(', ') + '.'
      : 'Most number tiles have ≤4 copies; "=" up to 8–11; operators ≤4–5.';
    return [
      'You are digitizing a photo of an A-Math / MathSmith board (a 15x15 grid of squares). This game uses the ' + tileSetName() + ' tile set. Read which tile, if any, sits on each square.',
      '',
      'Output ONLY a JSON object (no prose, no markdown) of EXACTLY this form:',
      '{"v":2,"grid":[ <row0>, <row1>, ... <row14> ]}',
      'where each row is an array of EXACTLY 15 strings (left to right), and there are EXACTLY 15 rows (top to bottom).',
      'Each string is "" for an empty square, or the tile face for an occupied square.',
      '',
      'This fixed grid matters: every square maps to one slot, so you must NOT invent extra tiles. Most squares are empty ("").',
      '',
      'How to read a tile:',
      '- A tile shows ONE large symbol in the center — output only that. The tiny number in the lower-right CORNER is the point value; it is NOT a tile and must be ignored. Example: a tile with a large "8" and a small "2" in the corner is "8" (never "2", never two tiles).',
      '- BLANK tile: a tile with NO symbol printed in the center (a plain blank face) and only a small "0" in the lower-right corner is a "BLANK" (a wildcard). Do NOT confuse it with the digit zero: the digit "0" tile has a large "0" printed in the CENTER, while a BLANK has an EMPTY center and just "0" in the corner. If the face is empty, output "BLANK".',
      '- ' + twoDigitNote + ' A two-digit tile is ONE tile in ONE square; never split "20" into "2" and "0".',
      '- Conversely, two ADJACENT squares that each hold a single digit are TWO separate tiles, not one two-digit number. A "2" square next to a "0" square is "2" and "0" (in two slots), NOT a single "20". Only call it "20" when both digits are printed on ONE physical tile.',
      '- Allowed faces: "0".."9", ' + twoDigits.map(function (f) { return '"' + f + '"'; }).join(',') + ', "+","-","=","±" (the +/- tile), "×" or "÷" (the ×/÷ tile used as multiply/divide), "BLANK".',
      '',
      'Do NOT read non-tiles: ignore the coordinate letters/numbers around the edges, and ignore square-bonus labels on empty squares ("DOUBLE","TRIPLE","EQUATION","PIECE","2X","3X","GAMESMITH"). An "X" in a bonus label is not a tile.',
      '',
      'Sanity check before answering: ' + countsLine + ' If your grid contains more of something than that, you have misread (often subscripts read as tiles) — re-read and correct.',
      'Return the JSON object only.'
    ].join('\n');
  }

  // ---- pull the JSON object out of the model reply --------------------------
  function extractJson(text) {
    if (!text) return null;
    var t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    if (t.charAt(0) === '{') return t;
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    return (s !== -1 && e > s) ? t.slice(s, e + 1) : null;
  }

  // ---- call Gemini ----------------------------------------------------------
  function callGemini(base64, key, temperature) {
    var body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: buildPrompt() }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: (typeof temperature === 'number' ? temperature : 0) }
    };
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) {
          var m = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
          throw new Error(m);
        }
        return data;
      });
    }).then(function (data) {
      var parts = data && data.candidates && data.candidates[0] &&
                  data.candidates[0].content && data.candidates[0].content.parts;
      if (!parts) {
        var fr = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
        throw new Error('No content returned' + (fr ? ' (' + fr + ')' : '') + '.');
      }
      return parts.map(function (p) { return p.text || ''; }).join('');
    });
  }

  // ---- choose transport: Firebase AI Logic (preferred) or raw key fallback --
  function analyze(base64) {
    if (window.AMath && typeof window.AMath.geminiScan === 'function') {
      return window.AMath.geminiScan(base64, buildPrompt());   // via Firebase proxy, no key, no CORS
    }
    var key = getKey();
    if (!key) return Promise.reject(new Error('NO_BACKEND'));
    return callGemini(base64, key);                            // raw fallback (may hit CORS)
  }

  // Merge several 15x15 grids by VOTE: a cell is kept only if a strict majority
  // of passes agree on the same tile there. Real tiles appear in most passes;
  // one-off misreads/hallucinations from a single pass are voted out.
  function normCell(s) { if (s == null) return ''; s = String(s).trim(); return (s === '.' || s === '-.') ? '' : s; }
  function mergeGrids(grids) {
    var need = grids.length <= 1 ? 1 : Math.floor(grids.length / 2) + 1; // 3→2, 2→2, 1→1
    var out = [];
    for (var r = 0; r < 15; r++) {
      var row = [];
      for (var c = 0; c < 15; c++) {
        var counts = {}, order = [];
        grids.forEach(function (g) {
          var v = (g[r] && g[r][c] != null) ? normCell(g[r][c]) : '';
          if (v === '') return;
          if (!(v in counts)) { counts[v] = 0; order.push(v); }
          counts[v]++;
        });
        var best = '', bestN = 0;
        order.forEach(function (v) { if (counts[v] > bestN) { bestN = counts[v]; best = v; } });
        row.push(bestN >= need ? best : '');   // require majority agreement
      }
      out.push(row);
    }
    return out;
  }

  // ---- orchestration --------------------------------------------------------

  // Ask the model for the playing grid's bounding box (fractions of the image),
  // so we can crop tightly to the board before reading — bigger tiles, no frame
  // or score-sheet distractions, and a steadier grid alignment.
  function detectBoard(base64) {
    var p = 'This is a photo of an A-Math / Scrabble-style board. Find the 15x15 grid of PLAYING SQUARES only. ' +
      'Exclude the outer plastic frame, the tile racks/trays, dice, and any paper or score sheets. ' +
      'Return ONLY JSON: {"x":<left>,"y":<top>,"w":<width>,"h":<height>} as fractions of the image size (0..1) for the tight bounding box of the grid. If unsure, return {"x":0,"y":0,"w":1,"h":1}.';
    return analyze2(base64, p).then(function (text) {
      try { var o = JSON.parse(extractJson(text) || 'null'); if (o && typeof o.x === 'number' && typeof o.w === 'number') return o; } catch (e) {}
      return null;
    }).catch(function () { return null; });
  }

  // Crop the image to the detected box (with a little padding) and scale the
  // crop up so tiles are large. Falls back to the original on any problem.
  function cropToBox(base64, box, cb) {
    if (!box) return cb(base64);
    var img = new Image();
    img.onload = function () {
      try {
        var W = img.width, H = img.height;
        var pad = 0.015;
        var x = Math.max(0, (box.x - pad)) * W, y = Math.max(0, (box.y - pad)) * H;
        var w = Math.min(1, (box.w + pad * 2)) * W, h = Math.min(1, (box.h + pad * 2)) * H;
        if (x + w > W) w = W - x; if (y + h > H) h = H - y;
        if (w < W * 0.30 || h < H * 0.30) return cb(base64); // implausible box → skip crop
        var scale = Math.min(2.0, 1800 / Math.max(w, h)); if (scale < 1) scale = 1;
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, cw, ch);
        cb(cv.toDataURL('image/jpeg', 0.9).split(',')[1]);
      } catch (e) { cb(base64); }
    };
    img.onerror = function () { cb(base64); };
    img.src = 'data:image/jpeg;base64,' + base64;
  }

  var PASS_TEMPS = [0.0, 0.2, 0.35, 0.5, 0.65];  // diverse reads → meaningful vote
  // Scan quality controls how many AI passes per scan (more passes = better
  // accuracy but more requests against the free quota). Default 'balanced'.
  // window.AMath.scanQuality can be set to 'fast' | 'balanced' | 'accurate'.
  function boardPasses() {
    var q = (window.AMath && window.AMath.scanQuality) || 'balanced';
    return q === 'fast' ? 1 : q === 'accurate' ? 5 : 3;
  }
  function rackPassCount() {
    var q = (window.AMath && window.AMath.scanQuality) || 'balanced';
    return q === 'accurate' ? 3 : 1;   // rack is a small read; 1 is usually plenty
  }

  function friendlyErr(err) {
    var m = String(err && err.message || err);
    if (m === 'NO_BACKEND') return 'Set up Firebase AI Logic in the console (recommended) or paste a Gemini key above.';
    if (/api key|API_KEY|invalid|permission|PERMISSION/i.test(m)) return 'Access rejected — check your Firebase AI Logic setup (or key).';
    if (/quota|rate|RESOURCE_EXHAUSTED/i.test(m)) return 'Free quota hit — wait a bit and try again.';
    if (/failed to fetch|networkerror|CORS/i.test(m)) return 'Network error reaching the AI service.';
    if (/app.?check|APP_CHECK/i.test(m)) return 'Blocked by App Check — disable enforcement for now, or register this domain.';
    return m;
  }

  // Read the board across PASSES (varied temperatures) and merge by vote.
  // Resolves to { grid, n } or { grid:null, err }.
  function runScanPasses(image) {
    var prompt = buildPrompt();
    var P = boardPasses();
    var done = 0, lastErr = null, jobs = [];
    for (var i = 0; i < P; i++) {
      var temp = PASS_TEMPS[i % PASS_TEMPS.length];
      jobs.push(
        analyze2(image, prompt, temp).then(function (text) {
          status('⏳ Reading board — pass ' + (++done) + '/' + P + '…');
          try { var o = JSON.parse(extractJson(text) || 'null'); return (o && Array.isArray(o.grid)) ? o.grid : null; }
          catch (e) { return null; }
        }).catch(function (e) { lastErr = e; return null; })
      );
    }
    return Promise.all(jobs).then(function (results) {
      var grids = results.filter(function (g) { return g; });
      if (!grids.length) return { grid: null, err: lastErr };
      return { grid: mergeGrids(grids), n: grids.length };
    });
  }

  // Read the player's rack from the (uncropped) image across a few passes and
  // merge per-position by vote. Resolves to an array of face strings (≤8).
  function rackPrompt() {
    return [
      'This photo shows a player\'s tile RACK / TRAY: a single row of up to 8 game tiles sitting in a holder (often a close-up of just the tray; a 15x15 board may or may not also be visible).',
      'Read ONLY the rack/tray tiles, in order from LEFT to RIGHT. If a 15x15 board is visible, ignore it.',
      'Each tile has a large face and a tiny corner number (its point value — IGNORE the corner number).',
      'BLANK tile: a tile with NO symbol in the center (plain/empty face) and only a small "0" in the corner is "BLANK" (a wildcard). Do not confuse it with the digit zero — the "0" digit tile has a large "0" printed in the CENTER. If the center is empty, it is "BLANK".',
      'Output ONLY JSON: {"rack":[ up to 8 strings ]}. Each string is the tile FACE: "0".."9","10","11","12","13","14","15","16","20","+","-","=","±" (the +/- tile), "×" or "÷" (the ×/÷ tile), "BLANK" (empty face, corner value 0).',
      'Include every tile in the tray, including a BLANK tile (a plain tile with an empty face). Do not skip any slot that holds a tile.',
      'If you truly see no rack/tray tiles at all, return {"rack":[]}.'
    ].join('\n');
  }
  function mergeRacks(lists) {
    // Lenient vote: with 3+ reads keep a face agreed by >=2; with 1-2 reads keep the plurality.
    var need = lists.length >= 3 ? 2 : 1;
    var out = [];
    for (var i = 0; i < 8; i++) {
      var counts = {}, order = [];
      lists.forEach(function (l) {
        var v = (l && l[i] != null) ? String(l[i]).trim() : '';
        if (v === '' || v === '.') return;
        if (!(v in counts)) { counts[v] = 0; order.push(v); }
        counts[v]++;
      });
      var best = '', bestN = 0;
      order.forEach(function (v) { if (counts[v] > bestN) { bestN = counts[v]; best = v; } });
      out.push(bestN >= need ? best : '');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }
  function runRackPasses(image) {
    var jobs = [];
    var RP = rackPassCount();
    for (var i = 0; i < RP; i++) {
      var temp = PASS_TEMPS[i % PASS_TEMPS.length];
      jobs.push(
        analyze2(image, rackPrompt(), temp).then(function (text) {
          try { var o = JSON.parse(extractJson(text) || 'null'); return { rack: (o && Array.isArray(o.rack)) ? o.rack : [] }; }
          catch (e) { return { rack: [] }; }
        }).catch(function (err) { return { err: err }; })
      );
    }
    return Promise.all(jobs).then(function (res) {
      var lists = [], firstErr = null;
      for (var k = 0; k < res.length; k++) {
        if (res[k] && res[k].rack && res[k].rack.length) lists.push(res[k].rack);
        else if (res[k] && res[k].err && !firstErr) firstErr = res[k].err;
      }
      if (!lists.length) {
        if (firstErr) throw firstErr;   // surface the real AI error instead of "couldn't read"
        return [];                      // model genuinely returned no tiles
      }
      return mergeRacks(lists);
    });
  }

  function applyScan(grid, rack) {
    var payload = { v: 2, grid: grid };
    if (rack && rack.length) payload.rack = rack;
    var ok = window.AMath.scanApply ? window.AMath.scanApply(JSON.stringify(payload), 'Scanned') : false;
    var rackNote = (rack && rack.length) ? (' + ' + rack.length + ' rack tile(s)') : '';
    if (ok) status('✅ Scanned' + rackNote + '. Check the grid below and fix any misreads.', '#34d399');
    else status('⚠️ Scanned' + rackNote + ', but some cells need fixing — see the message below the grid.', '#fbbf24');
  }

  function onPhoto(file) {
    if (!file) return;
    status('⏳ Reading photo…');
    fileToBase64(file, function (base64) {
      if (!base64) { status('❌ Could not read that image.', '#f87171'); return; }
      var rackEl = document.getElementById('read-rack');
      var wantRack = !!(rackEl && rackEl.checked);
      status('⏳ Finding the board edges…');
      detectBoard(base64).then(function (box) {
        cropToBox(base64, box, function (cropped) {
          status('⏳ Reading board — ' + boardPasses() + ' pass(es)…');
          runScanPasses(cropped).then(function (r) {
            if (!r.grid) { status('❌ ' + (r.err ? friendlyErr(r.err) : 'The model did not return readable board data. Try a flatter, well-lit photo.'), '#f87171'); return; }
            if (!wantRack) { applyScan(r.grid, null); return; }
            status('⏳ Reading your rack…');
            runRackPasses(base64).then(function (rack) { applyScan(r.grid, rack); })
              .catch(function () { applyScan(r.grid, null); });
          }).catch(function (err) { status('❌ ' + friendlyErr(err), '#f87171'); });
        });
      });
    });
  }

  // analyze() that takes an explicit prompt (so all passes share one prompt build)
  function analyze2(base64, prompt, temperature) {
    if (window.AMath && typeof window.AMath.geminiScan === 'function') {
      return window.AMath.geminiScan(base64, prompt, temperature);
    }
    var key = getKey();
    if (!key) return Promise.reject(new Error('NO_BACKEND'));
    return callGemini(base64, key, temperature);
  }
  function _onPhoto_OLD(file) {
    if (!file) return;
    status('⏳ Reading photo…');
    fileToBase64(file, function (base64) {
      if (!base64) { status('❌ Could not read that image.', '#f87171'); return; }
      status('⏳ Analyzing board… (this can take ~10s)');
      analyze(base64).then(function (text) {
        var json = extractJson(text);
        if (!json) { status('❌ The model did not return readable board data. Try a flatter, well-lit photo.', '#f87171'); return; }
        var ok = window.AMath.scanApply ? window.AMath.scanApply(json, 'Scanned photo') : false;
        if (ok) status('✅ Scanned. Check the grid below and fix any misread tiles.', '#34d399');
        else status('⚠️ Scanned, but some cells need fixing — see the message below the grid.', '#fbbf24');
      }).catch(function (err) {
        var m = String(err && err.message || err);
        if (m === 'NO_BACKEND') m = 'Set up Firebase AI Logic in the console (recommended) or paste a Gemini key above.';
        else if (/api key|API_KEY|invalid|permission|PERMISSION/i.test(m)) m = 'Access rejected — check your Firebase AI Logic setup (or key).';
        else if (/quota|rate|RESOURCE_EXHAUSTED/i.test(m)) m = 'Free quota hit — wait a bit and try again.';
        else if (/failed to fetch|networkerror|CORS/i.test(m)) m = 'Network error reaching the AI service.';
        else if (/app.?check|APP_CHECK/i.test(m)) m = 'Blocked by App Check — disable enforcement for now, or register this domain.';
        status('❌ ' + m, '#f87171');
      });
    });
  }

  // Public: read just the rack/tray from a photo file (used by the Calculator
  // page). Resolves to an array of face strings (≤8).
  window.AMath = window.AMath || {};
  window.AMath.scanRackFromFile = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('No file')); return; }
      fileToBase64(file, function (base64) {
        if (!base64) { reject(new Error('Could not read that image.')); return; }
        runRackPasses(base64).then(resolve).catch(function (err) { reject(new Error(friendlyErr(err))); });
      });
    });
  };

  // ---- wire UI --------------------------------------------------------------
  function init() {
    var keyInput = document.getElementById('gemini-key');
    var saveBtn = document.getElementById('btn-save-key');
    var photoBtn = document.getElementById('btn-photo');
    var photoInput = document.getElementById('photo-input');
    if (!photoBtn || !photoInput) return; // camera section not on page

    if (keyInput && getKey()) keyInput.placeholder = 'Gemini key saved ✓ (tap to replace)';
    if (saveBtn && keyInput) {
      saveBtn.addEventListener('click', function () {
        var v = (keyInput.value || '').trim();
        if (!v) { status('Enter a key to save.', '#fbbf24'); return; }
        saveKey(v);
        keyInput.value = '';
        keyInput.placeholder = 'Gemini key saved ✓ (tap to replace)';
        status('✅ Key saved on this device.', '#34d399');
      });
    }
    photoBtn.addEventListener('click', function () { photoInput.click(); });
    photoInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      onPhoto(f);
      e.target.value = ''; // allow re-selecting the same file
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
