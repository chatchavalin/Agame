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
  function buildPrompt() {
    return [
      'You are digitizing a photo of an A-Math / MathSmith board (a 15x15 grid of squares). Read which tile, if any, sits on each square.',
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
      '- Two-digit tiles (10,11,12,13,14,15,16,20) are ONE tile in ONE square. Never split "20" into "2" and "0".',
      '- Allowed faces: "0".."9","10","11","12","13","14","15","16","20","+","-","=","±" (the +/- tile), "×" or "÷" (the ×/÷ tile used as multiply/divide), "BLANK". Tiles 17,18,19 do not exist.',
      '',
      'Do NOT read non-tiles: ignore the coordinate letters/numbers around the edges, and ignore square-bonus labels on empty squares ("DOUBLE","TRIPLE","EQUATION","PIECE","2X","3X","GAMESMITH"). An "X" in a bonus label is not a tile.',
      '',
      'Sanity check before answering: the whole game has at most 4 of most number tiles (fewer of 5-9 and of two-digit tiles), 8 "=", 4 "+", 4 "-", 5 "±", 4 "×/÷". If your grid contains far more of something than could exist, you have misread subscripts as tiles — re-read and correct.',
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
  function callGemini(base64, key) {
    var body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: buildPrompt() }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
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

  // Merge several 15x15 grids: each cell = the most common non-empty reading
  // across passes (so a tile any pass saw is kept, and disagreements are voted).
  function normCell(s) { if (s == null) return ''; s = String(s).trim(); return (s === '.' || s === '-.') ? '' : s; }
  function mergeGrids(grids) {
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
        row.push(best);
      }
      out.push(row);
    }
    return out;
  }

  // ---- orchestration --------------------------------------------------------
  var PASSES = 3;
  function onPhoto(file) {
    if (!file) return;
    status('⏳ Reading photo…');
    fileToBase64(file, function (base64) {
      if (!base64) { status('❌ Could not read that image.', '#f87171'); return; }
      var prompt = buildPrompt();
      var done = 0;
      var jobs = [];
      for (var i = 0; i < PASSES; i++) {
        jobs.push(
          analyze2(base64, prompt).then(function (text) {
            status('⏳ Reading board — pass ' + (++done) + '/' + PASSES + '…');
            try { var o = JSON.parse(extractJson(text) || 'null'); return (o && Array.isArray(o.grid)) ? o.grid : null; }
            catch (e) { return null; }
          }).catch(function () { return null; })
        );
      }
      status('⏳ Reading board — ' + PASSES + ' passes for accuracy… (~20s)');
      Promise.all(jobs).then(function (results) {
        var grids = results.filter(function (g) { return g; });
        if (!grids.length) { status('❌ The model did not return readable board data. Try a flatter, well-lit photo.', '#f87171'); return; }
        var json = JSON.stringify({ v: 2, grid: mergeGrids(grids) });
        var ok = window.AMath.scanApply ? window.AMath.scanApply(json, 'Scanned (' + grids.length + ' passes merged)') : false;
        if (ok) status('✅ Scanned (' + grids.length + ' passes merged). Check the grid below and fix any misreads.', '#34d399');
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

  // analyze() that takes an explicit prompt (so all passes share one prompt build)
  function analyze2(base64, prompt) {
    if (window.AMath && typeof window.AMath.geminiScan === 'function') {
      return window.AMath.geminiScan(base64, prompt);
    }
    var key = getKey();
    if (!key) return Promise.reject(new Error('NO_BACKEND'));
    return callGemini(base64, key);
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
