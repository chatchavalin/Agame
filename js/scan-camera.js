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
      'You are reading a photo of an A-Math / MathSmith board game. The board is a 15x15 grid.',
      'Identify every tile placed on the board and output ONLY a JSON object (no prose, no markdown fences) of this exact form:',
      '{"v":1,"board":[{"r":<row 0-14 from top>,"c":<col 0-14 from left>,"f":"<face>"}],"rack":[]}',
      'Rules:',
      '- r=0 is the TOP row; c=0 is the LEFT column.',
      '- Include ONLY cells that contain a tile. Omit every empty cell.',
      '- "f" MUST be exactly one of: "0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","20","+","-","+/-","×/÷","=","BLANK".',
      '- A tile showing ± is "+/-". A tile showing a combined ×÷ symbol is "×/÷". For these, if you can tell which single operation it is used as in the equation, also add "a" set to "+","-","×" or "÷"; if unsure, omit "a".',
      '- A blank tile (no printed value, often marked GAMESMITH or empty) is "BLANK"; if it clearly represents a value in the equation, add "a" with that value.',
      '- Read ONLY the large central number/symbol on each tile. IGNORE the small subscript point number in the corner.',
      '- Tiles 17, 18, 19 do NOT exist. Numbers 10-16 and 20 are SINGLE two-digit tiles.',
      '- Do NOT include the player racks. Always set "rack" to [].',
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

  // ---- orchestration --------------------------------------------------------
  function onPhoto(file) {
    var key = getKey();
    if (!key) { status('❌ Add your Gemini API key first (field above).', '#f87171'); return; }
    if (!file) return;
    status('⏳ Reading photo…');
    fileToBase64(file, function (base64) {
      if (!base64) { status('❌ Could not read that image.', '#f87171'); return; }
      status('⏳ Analyzing board with Gemini… (this can take ~10s)');
      callGemini(base64, key).then(function (text) {
        var json = extractJson(text);
        if (!json) { status('❌ Gemini did not return readable board data. Try a flatter, well-lit photo.', '#f87171'); return; }
        var ok = window.AMath.scanApply ? window.AMath.scanApply(json, 'Scanned photo') : false;
        if (ok) status('✅ Scanned. Check the grid below and fix any misread tiles.', '#34d399');
        else status('⚠️ Scanned, but some cells need fixing — see the message below the grid.', '#fbbf24');
      }).catch(function (err) {
        var m = String(err && err.message || err);
        if (/api key|API_KEY|invalid|permission/i.test(m)) m = 'Key rejected — check your Gemini API key.';
        else if (/quota|rate|RESOURCE_EXHAUSTED/i.test(m)) m = 'Free quota hit — wait a bit and try again.';
        else if (/failed to fetch|networkerror/i.test(m)) m = 'Network/CORS error reaching Gemini.';
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
