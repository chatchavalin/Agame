/**
 * scan-ai.js — Firebase AI Logic path for the Scan feature (ES module).
 *
 * Routes the board photo through Firebase AI Logic's proxy to the Gemini
 * Developer API (free tier on the Spark plan). This avoids the CORS block of
 * calling generativelanguage.googleapis.com directly, and keeps no raw API key
 * in the page (the key lives in the Firebase project, guarded by App Check).
 *
 * Loaded as <script type="module">. Exposes window.AMath.geminiScan(base64, prompt)
 * which scan-camera.js calls in preference to the raw-fetch fallback.
 *
 * SDK shape confirmed from firebase.google.com/docs/ai-logic/get-started
 * (Web, updated 2026-05-27):
 *   getAI(app, { backend: new GoogleAIBackend() })  // GoogleAIBackend = free Developer API
 *   getGenerativeModel(ai, { model })
 *   (await model.generateContent([imagePart, prompt])).response.text()
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-ai.js";

// Same public config the rest of the app uses (js/firebase-config.js).
const firebaseConfig = {
  apiKey: "AIzaSyCPO4CKH0RO7q1ZySkS9OMTBnU5I0qpusw",
  authDomain: "amath-52dd0.firebaseapp.com",
  projectId: "amath-52dd0",
  storageBucket: "amath-52dd0.firebasestorage.app",
  messagingSenderId: "553955164397",
  appId: "1:553955164397:web:c12f480787b57075890ce",
  measurementId: "G-F0W9005PMC"
};

// Vision-capable model on the free Gemini Developer API tier. Swappable here if
// Google retires it (see firebase.google.com/docs/ai-logic/models).
const MODEL = "gemini-2.5-flash";

let _models = {};
function ensureModel(temp) {
  var key = String(temp);
  if (_models[key]) return _models[key];
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _models[key] = getGenerativeModel(ai, {
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: temp }
  });
  return _models[key];
}

window.AMath = window.AMath || {};

/**
 * Analyze a base64 JPEG of the board. Returns the model's text (expected JSON).
 * @param {string} base64  image data without the data: prefix
 * @param {string} prompt  the board-reading instruction (built in scan-camera.js)
 * @param {number} [temperature]  sampling temperature (varied across passes so a
 *                                multi-pass vote sees genuinely different reads)
 */
window.AMath.geminiScan = async function (base64, prompt, temperature) {
  const t = (typeof temperature === "number") ? temperature : 0;
  const model = ensureModel(t);
  const imagePart = { inlineData: { mimeType: "image/jpeg", data: base64 } };
  // Best practice: image first, then the text instruction.
  const result = await model.generateContent([imagePart, prompt]);
  return result.response.text();
};

// Flag so the UI can tell the user the no-key path is ready.
window.AMath.geminiReady = true;
