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
  var MAX_DIM = 1600;   // cap longest side; smaller = much faster upload on mobile data, still legible for tiles

  function getKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } }
  function saveKey(k) { try { localStorage.setItem(KEY_LS, k); } catch (e) {} }

  function status(msg, color) {
    var el = document.getElementById('camera-status');
    if (el) { el.innerHTML = msg; el.style.color = color || '#94a3b8'; }
  }

  // ---- downscale a chosen image file to a base64 JPEG -----------------------
  function fileToBase64(file, cb) {
    // Draw onto a canvas at MAX_DIM, returning base64 JPEG. Crucially, honor the
    // photo's EXIF orientation flag — phones often store portrait shots as
    // sideways pixels + a "rotate me" flag; <img>/drawImage ignore the flag, which
    // fed Gemini sideways boards. createImageBitmap({imageOrientation:'from-image'})
    // applies the flag so the pixels come out upright.
    function fromBitmap() {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
        var w = bmp.width, h = bmp.height;
        var scale = Math.min(1, MAX_DIM / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
        if (bmp.close) bmp.close();
        return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      });
    }
    function legacy() {  // fallback for browsers without createImageBitmap options
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(); };
        reader.onload = function (e) {
          var img = new Image();
          img.onerror = function () { reject(); };
          img.onload = function () {
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, MAX_DIM / Math.max(w, h));
            var cw = Math.round(w * scale), ch = Math.round(h * scale);
            var canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
            try { resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]); }
            catch (err) { reject(); }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }
    var p;
    if (typeof createImageBitmap === 'function') {
      p = fromBitmap().catch(function () { return legacy(); });
    } else {
      p = legacy();
    }
    // Hard guard: always call back within 8s, even if decode/load never settles.
    var done = false;
    function finish(out) { if (done) return; done = true; clearTimeout(timer); cb(out); }
    var timer = setTimeout(function () { finish(null); }, 8000);
    p.then(function (b64) { finish(b64 || null); }, function () { finish(null); });
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
  function callGemini(base64, key, temperature, prompt) {
    var body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: prompt || buildPrompt() }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: (typeof temperature === 'number' ? temperature : 0) }
    };
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    if (ctrl) { try { setTimeout(function () { ctrl.abort(); }, 30000); } catch (e) {} }
    // Send the key as a query param and use only a "simple" Content-Type so the
    // request does NOT trigger a CORS preflight (OPTIONS). A custom header like
    // x-goog-api-key forces a preflight that this endpoint can leave hanging.
    var url = ENDPOINT + '?key=' + encodeURIComponent(key);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
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
    // Shorter cap than a full read: if detection stalls, just scan the whole image.
    return withTimeout(analyze2Raw(base64, p, 0), 18000, 'Finding the board').then(function (text) {
      try { var o = JSON.parse(extractJson(text) || 'null'); if (o && typeof o.x === 'number' && typeof o.w === 'number') return o; } catch (e) {}
      return null;
    }).catch(function () { return null; });
  }

  // Crop the image to the detected box (with a little padding) and scale the
  // crop up so tiles are large. Falls back to the original on any problem.
  function cropToBox(base64, box, cb) {
    if (!box) return cb(base64);
    var done = false;
    function finish(out) { if (done) return; done = true; clearTimeout(timer); cb(out); }
    var timer = setTimeout(function () { finish(base64); }, 5000); // never hang on a stalled image load
    var img = new Image();
    img.onload = function () {
      try {
        var W = img.width, H = img.height;
        var pad = 0.015;
        var x = Math.max(0, (box.x - pad)) * W, y = Math.max(0, (box.y - pad)) * H;
        var w = Math.min(1, (box.w + pad * 2)) * W, h = Math.min(1, (box.h + pad * 2)) * H;
        if (x + w > W) w = W - x; if (y + h > H) h = H - y;
        if (w < W * 0.30 || h < H * 0.30) return finish(base64); // implausible box → skip crop
        var scale = Math.min(2.0, 1800 / Math.max(w, h)); if (scale < 1) scale = 1;
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, cw, ch);
        finish(cv.toDataURL('image/jpeg', 0.9).split(',')[1]);
      } catch (e) { finish(base64); }
    };
    img.onerror = function () { finish(base64); };
    img.src = 'data:image/jpeg;base64,' + base64;
  }

  // Normalize lighting before reading: stretch contrast per-channel (ignoring
  // the extreme 1% tails) and gently roll off blown-out highlights. This makes
  // the white tile glyphs stand out against the blue tiles under uneven light /
  // mild glare. Conservative on purpose — strong filters make the model
  // hallucinate. Falls back to the input on any problem.
  function normalizeImage(base64, cb) {
    // Hard guard: whatever happens, call back within 4s with at worst the
    // original image, so the scan flow can never hang on this step.
    var done = false;
    function finish(out) { if (done) return; done = true; cb(out); }
    var timer = setTimeout(function () { finish(base64); }, 4000);
    function cbSafe(out) { clearTimeout(timer); finish(out); }

    var img = new Image();
    img.onerror = function () { cbSafe(base64); };
    img.onload = function () {
      try {
        var w = img.width, h = img.height;
        // Cap the work: processing many megapixels per-pixel on the main thread
        // can stall a phone. If the crop is huge, skip normalization rather than freeze.
        if (w * h > 3500000) { cbSafe(base64); return; }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var data = ctx.getImageData(0, 0, w, h), px = data.data, n = px.length;
        var hist = new Array(256).fill(0), total = (n / 4) | 0;
        for (var i = 0; i < n; i += 4) {
          var l = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
          hist[l]++;
        }
        var lo = 0, hi = 255, cum = 0, loCut = total * 0.01, hiCut = total * 0.99;
        for (var b = 0; b < 256; b++) { cum += hist[b]; if (cum >= loCut) { lo = b; break; } }
        cum = 0;
        for (var b2 = 0; b2 < 256; b2++) { cum += hist[b2]; if (cum >= hiCut) { hi = b2; break; } }
        if (hi - lo < 32) { cbSafe(base64); return; }
        var range = hi - lo;
        for (var j = 0; j < n; j += 4) {
          for (var k = 0; k < 3; k++) {
            var v = (px[j + k] - lo) * 255 / range;
            px[j + k] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
        ctx.putImageData(data, 0, 0);
        cbSafe(cv.toDataURL('image/jpeg', 0.9).split(',')[1]);
      } catch (e) { cbSafe(base64); }
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  }


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
    if (m === 'NO_KEY') return 'Paste your own free Gemini API key above to use scanning (get one at aistudio.google.com/apikey). Your key stays in your browser.';
    if (m === 'NO_BACKEND') return 'Paste your own free Gemini API key above to use scanning.';
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
    var done = 0, lastErr = null, sampleText = null, jobs = [];
    for (var i = 0; i < P; i++) {
      var temp = PASS_TEMPS[i % PASS_TEMPS.length];
      jobs.push(
        analyze2(image, prompt, temp).then(function (text) {
          done++;
          try { var o = JSON.parse(extractJson(text) || 'null'); if (o && Array.isArray(o.grid)) return o.grid; } catch (e) {}
          if (!sampleText && text) sampleText = String(text).slice(0, 160);  // keep a sample for diagnostics
          return null;
        }).catch(function (e) { lastErr = e; return null; })
      );
    }
    return Promise.all(jobs).then(function (results) {
      var grids = results.filter(function (g) { return g; });
      if (!grids.length) return { grid: null, err: lastErr, sample: sampleText };
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
    return new Promise(function (resolveOuter, rejectOuter) {
      normalizeImage(image, function (prepped) {
        _runRackPasses(prepped).then(resolveOuter, rejectOuter);
      });
    });
  }
  function _runRackPasses(image) {
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

  // Live elapsed-time ticker so the user can see the scan is working (and tell
  // "slow" from "stuck"). Call startTicker(prefix, onTimeout) and stopTicker().
  var _ticker = null, _onTimeout = null, _abandoned = false, _tickNow = null;
  var SCAN_DEADLINE = 35; // seconds of wall-clock before we abandon the read
  function startTicker(prefix, onTimeout) {
    stopTicker();
    _onTimeout = onTimeout || null;
    var t0 = Date.now();
    function tick() {
      var s = Math.round((Date.now() - t0) / 1000);
      if (s >= SCAN_DEADLINE) {
        stopTicker();
        var cb = _onTimeout; _onTimeout = null;
        if (cb) cb(s);
        return;
      }
      var extra = '';
      if (s >= 12) extra = ' &nbsp;<a href="#" onclick="window.AMath.cancelScan&&window.AMath.cancelScan();return false;" style="color:#fbbf24;">Taking too long? Tap to stop</a>';
      status('⏳ ' + prefix + ' — ' + s + 's' + extra);
    }
    _tickNow = tick;
    tick();
    _ticker = setInterval(tick, 1000);
  }
  function stopTicker() { if (_ticker) { clearInterval(_ticker); _ticker = null; } _onTimeout = null; _tickNow = null; }
  // When the tab is backgrounded (e.g. while the photo picker is open) the
  // browser freezes our timers, so the ticker stops mid-count. The moment the
  // tab becomes visible again, run a tick immediately so a past-deadline read aborts.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && _tickNow) { try { _tickNow(); } catch (e) {} }
  });
  window.AMath = window.AMath || {};
  window.AMath.cancelScan = function () {
    _abandoned = true;
    stopTicker();
    status('⏹️ Stopped. Tap "Take / choose photo" to try again — try Fast quality and a flat, well-lit photo.', '#fbbf24');
  };

  var _dbg0 = 0;
  function dbg(msg) {
    if (!_dbg0) _dbg0 = Date.now();
    var t = ((Date.now() - _dbg0) / 1000).toFixed(1);
    try {
      var el = document.getElementById('scan-debug');
      if (!el) {
        var host = document.getElementById('camera-status');
        if (host && host.parentNode) {
          el = document.createElement('div');
          el.id = 'scan-debug';
          el.style.cssText = 'margin-top:8px;font-size:11px;color:#94a3b8;font-family:monospace;white-space:pre-wrap;background:#0b1220;border:1px solid #1e293b;border-radius:8px;padding:8px;max-height:160px;overflow:auto;';
          host.parentNode.insertBefore(el, host.nextSibling);
        }
      }
      if (el) el.textContent += '[' + t + 's] ' + msg + '\n';
    } catch (e) {}
  }
  function onPhoto(file) {
    if (!file) return;
    _dbg0 = 0; dbg('tapped scan; quality=' + ((window.AMath && window.AMath.scanQuality) || 'balanced') + '; backend=' + (isOwner() ? ('owner(module ' + (window.AMath && typeof window.AMath.geminiScan === 'function' ? 'loaded' : 'MISSING') + ')') : 'pastedKey'));
    status('⏳ Reading photo…');
    dbg('decoding image…');
    fileToBase64(file, function (base64) {
      if (!base64) { dbg('decode FAILED'); status('❌ Could not read that image.', '#f87171'); return; }
      dbg('decoded ok, base64 len=' + base64.length);
      var rackEl = document.getElementById('read-rack');
      var wantRack = !!(rackEl && rackEl.checked);
      var quality = (window.AMath && window.AMath.scanQuality) || 'balanced';
      var fast = (quality === 'fast');

      function readBoard(imageForBoard) {
        var settled = false;
        dbg('calling AI (image len=' + imageForBoard.length + ')…');
        startTicker('Reading board (' + boardPasses() + ' pass)', function (secs) {
          if (settled) return; settled = true;
          dbg('TICKER deadline hit at ' + secs + 's — aborting');
          var path = isOwner() ? 'owner/Firebase backend' : 'your pasted key';
          var via = (isOwner() && !(window.AMath && typeof window.AMath.geminiScan === 'function'))
            ? ' (note: the owner AI module did NOT load, so your phrase was sent as a raw API key — that will fail)'
            : '';
          status('❌ Gave up after ' + secs + 's using ' + path + via + '. The AI request never returned — likely slow connection, CORS block on the direct-key path, or a key/quota issue. Try Wi-Fi, or tap tiles in manually.', '#f87171');
        });
        runScanPasses(imageForBoard).then(function (r) {
          if (settled) return; settled = true; stopTicker();
          dbg('AI returned: ' + (r.grid ? 'grid ok' : ('no grid; err=' + (r.err && r.err.message) + '; sample=' + (r.sample || '∅'))));
          if (!r.grid) { status('❌ ' + (r.err ? friendlyErr(r.err) : ('The model didn\'t return a board grid.' + (r.sample ? ' It said: "' + r.sample + '…"' : ' Try a flatter, well-lit photo.'))), '#f87171'); return; }
          if (!wantRack) { applyScan(r.grid, null); return; }
          startTicker('Reading your rack');
          runRackPasses(base64).then(function (rack) { stopTicker(); applyScan(r.grid, rack); })
            .catch(function () { stopTicker(); applyScan(r.grid, null); });
        }).catch(function (err) { if (settled) return; settled = true; stopTicker(); dbg('AI threw: ' + (err && err.message)); status('❌ ' + friendlyErr(err), '#f87171'); });
      }

      if (fast) {
        dbg('fast path: direct read, no detect/crop/normalize');
        readBoard(base64);
      } else {
        dbg('full path: detectBoard…');
        status('⏳ Finding the board edges…');
        detectBoard(base64).then(function (box) {
          dbg('detectBoard done (box=' + (box ? 'yes' : 'none') + '); cropping…');
          cropToBox(base64, box, function (cropped) {
            dbg('crop done; normalizing…');
            normalizeImage(cropped, function (prepped) { dbg('normalize done'); readBoard(prepped); });
          });
        }).catch(function () { dbg('detectBoard failed; full-image read'); readBoard(base64); });
      }
    });
  }

  // analyze() that takes an explicit prompt (so all passes share one prompt build)
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t0 = Date.now();
      // Poll on an interval and compare wall-clock time. setTimeout alone can be
      // paused/throttled when a mobile tab is backgrounded; a short polling
      // interval that checks Date.now() recovers and fires as soon as the tab is
      // active again, so a hung request can't sit forever.
      var iv = setInterval(function () {
        if (done) { clearInterval(iv); return; }
        if (Date.now() - t0 >= ms) {
          done = true; clearInterval(iv);
          reject(new Error((label || 'Request') + ' timed out after ' + Math.round((Date.now() - t0) / 1000) + 's — check your connection / Gemini key and try again.'));
        }
      }, 1000);
      promise.then(function (v) { if (done) return; done = true; clearInterval(iv); resolve(v); },
                   function (e) { if (done) return; done = true; clearInterval(iv); reject(e); });
    });
  }
  // Owner unlock: only the app owner may use the shared Firebase backend (which
  // bills the owner's Gemini quota). Everyone else must paste their OWN Gemini
  // key, which is sent straight to Google from their browser — never our backend.
  // To use the owner backend, paste this exact phrase into the key box.
  var OWNER_PHRASE = 'owner:amath2026';
  function isOwner() { return getKey().trim() === OWNER_PHRASE; }

  function analyze2Raw(base64, prompt, temperature) {
    var stored = getKey().trim();
    if (stored === OWNER_PHRASE && window.AMath && typeof window.AMath.geminiScan === 'function') {
      dbg('-> dispatching to owner Firebase backend (geminiScan)');
      return window.AMath.geminiScan(base64, prompt, temperature);   // owner: shared backend
    } else if (stored) {
      dbg('-> dispatching to direct Google fetch with key');
      return callGemini(base64, stored, temperature, prompt);        // others: their own key
    }
    return Promise.reject(new Error('NO_KEY'));
  }
  function analyze2(base64, prompt, temperature) {
    return withTimeout(analyze2Raw(base64, prompt, temperature), 30000, 'Reading the photo'); // 30s/pass
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

  var JS_VERSION = 'v137';
  // ---- wire UI --------------------------------------------------------------
  function init() {
    var stamp = document.getElementById('build-stamp');
    if (stamp) stamp.textContent = JS_VERSION + ' js✓';   // proves which scan-camera.js actually ran
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
        // Validate: real Gemini keys look like "AIza" + ~35 chars. The owner
        // unlock phrase is the one allowed exception. Reject anything else so a
        // typo/random word can't be saved and fail confusingly at scan time.
        var looksLikeKey = /^AIza[0-9A-Za-z_\-]{30,}$/.test(v);
        var isOwnerPhrase = (v === OWNER_PHRASE);
        if (!looksLikeKey && !isOwnerPhrase) {
          status('❌ That doesn\'t look like a Gemini API key. A real key starts with "AIza" and is ~39 characters. Get one free at aistudio.google.com/apikey, then paste the whole thing.', '#f87171');
          return;   // do NOT save invalid input
        }
        saveKey(v);
        keyInput.value = '';
        keyInput.placeholder = 'Gemini key saved ✓ (tap to replace)';
        status(isOwnerPhrase ? '✅ Owner mode enabled on this device.' : '✅ Key saved on this device. Tap "Take / choose photo" to scan.', '#34d399');
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
