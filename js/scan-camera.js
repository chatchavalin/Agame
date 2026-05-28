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
  var MAX_DIM = 1280;   // downscale longest side before upload (keeps request small)

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
      'You are reading a photo of an A-Math / MathSmith board game to digitize it. The play area is a 15x15 grid of square cells. Most cells are EMPTY.',
      'Output ONLY a JSON object (no prose, no markdown fences) of this exact form:',
      '{"v":1,"board":[{"r":<row 0-14 from top>,"c":<col 0-14 from left>,"f":"<face>"}],"rack":[]}',
      '',
      'CRITICAL RULES — follow exactly:',
      '1. ONE tile per cell maximum. Never output two entries for the same (r,c).',
      '2. The small number in the CORNER of a tile is its POINT VALUE, not a tile. IGNORE it completely. Read only the LARGE symbol in the middle of the tile.',
      '3. Two-digit tiles (10, 11, 12, 13, 14, 15, 16, 20) are SINGLE tiles occupying ONE cell. NEVER split them into two single-digit tiles. If a cell shows "20", output one {"f":"20"} — not a "2" and a "0".',
      '4. Read ONLY tiles sitting inside the 15x15 grid. IGNORE everything else in the photo: the plastic frame, the player racks/trays, the dice, score sheets, and any printed tile-frequency tables or text on paper.',
      '5. "f" MUST be exactly one of: "0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","20","+","-","+/-","×/÷","=","BLANK". (Tiles 17,18,19 do NOT exist.)',
      '6. A ± tile is "+/-"; a combined ×÷ tile is "×/÷". If you can tell which operation it is used as, add "a":"+"/"-"/"×"/"÷"; else omit "a". A blank tile is "BLANK".',
      '',
      'TILE SUPPLY (the whole game has only these many of each — you can NOT see more than this on the board, so if you are about to exceed a count you have misread something):',
      '0×4, 1×4, 2×4, 3×4, 4×4, 5×3, 6×3, 7×2, 8×3, 9×2, 10×1, 11×1, 12×1, 13×1, 14×1, 15×1, 16×1, 20×1, +×4, -×4, +/-×5, ×/÷×4, =×8, BLANK×4.',
      '',
      'Tiles are placed along straight lines forming equations (e.g. "2 ÷ 8 5 = 9 1"). Use that to sanity-check your reading. Set "rack" to []. Return the JSON object only.'
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

  // ---- orchestration --------------------------------------------------------
  function onPhoto(file) {
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
