# A-Math Board Game — Project Bible

**Last updated:** 2026-05-23
**GitHub:** https://github.com/chatchavalin/Agame
**Live:** https://chatchavalin.github.io/Agame/
**Stack:** Vanilla JS (no framework), single-page, mobile-first, ~22,000 lines

---

## 1. WHAT IS THIS GAME?

A-Math is a competitive math board game (like Scrabble but with math equations).
Players place number/operator tiles on a 15×15 board to form valid equations.

### Core Rules
- **Board:** 15×15 grid with premium squares (2T, 3T, 2E, 3E)
- **Tiles:** Numbers (0-20), operators (+, -, ×, ÷, =), blanks (?), choice tiles (+/-, ×/÷)
- **Rack:** 8 tiles per player
- **First move** must pass through center (★) at row 7, col 7
- **Equations** must be mathematically valid (e.g., `3+4=7`, `2+3=5=4+1`)
- **Scoring:** Sum of tile points × premium multipliers
- **Bingo:** Place all 8 tiles = +40 bonus
- **×9 play:** Equation crossing two 3E squares on same line = score ×9
- **YoYo:** Extend existing equation to fill entire 15-cell line
- **Game ends:** Bag empty + one player uses all tiles, OR 6 consecutive pass/swap turns

### Two Tile Sets
- **Prathom (ประถม):** Simpler, numbers 0-16 + 20
- **Mathayom (มัธยม):** Full, numbers 0-20

### Blank Tile Rules
- Can be assigned ANY value from the active inventory
- Prathom: 23 choices (0-16, 20, +, -, ×, ÷, =)
- Mathayom: 26 choices (0-20, +, -, ×, ÷, =)
- Blank always scores 0 points regardless of assigned value

---

## 2. FILE STRUCTURE

```
├── index.html              # Single HTML entry point
├── styles.css              # All styling (~2700 lines), 12 themes
├── js/
│   ├── main.js             # Game loop, turn management (~3000 lines)
│   ├── ai-player.js        # AI decision engine (~3300 lines)
│   ├── ai-yoyo.js          # YoYo (15-cell line) search
│   ├── ai-x9.js            # ×9 threat detection & defense
│   ├── ai-x4.js            # ×4 threat detection
│   ├── ai-bingo-fast.js    # Fast bingo (8-tile) search
│   ├── ai-bingo-grammar.js # Grammar-based bingo search
│   ├── ai-swap-brain2.js   # Swap strategy
│   ├── ai-patterns-engine.js # Pattern matching
│   ├── board.js            # Board state management
│   ├── bag.js              # Tile bag
│   ├── rack.js             # Rack management
│   ├── placement.js        # Move validation
│   ├── scoring.js          # Score calculation
│   ├── evaluator.js        # Equation evaluation
│   ├── constants.js        # Game constants, inventory, lines
│   ├── interactions.js     # Touch/click handling
│   ├── ui.js               # UI rendering
│   ├── settings.js         # Settings dialog, theme switching
│   ├── modes.js            # Game modes (PvA, PvP, AI vs AI, Auto)
│   ├── education.js        # Verify popup, background search
│   ├── challenge.js        # Challenge mechanics
│   ├── trash-talk.js       # AI trash talk messages (~750 lines)
│   ├── game-log.js         # Game logging for debugging
│   ├── score-sheet.js      # Score sheet popup
│   ├── tile-tracker.js     # Tile inventory tracker
│   ├── save-resume.js      # Save/load game state
│   ├── sounds.js           # Sound effects
│   ├── animations.js       # Visual animations
│   └── [other support files]
├── tests/
│   ├── run-tests.py        # 40-test automated suite (Playwright)
│   └── syntax-check.js     # Quick syntax + bug pattern check
```

---

## 3. CRITICAL API CONTRACTS

### Validation
```javascript
// placement.js → validatePlay()
// Returns: { ok: true, equations: [...], direction, newTilesCount }
//      or: { ok: false, reason: 'human-readable error' }
// ⚠️ NEVER use .valid — always use .ok
```

### Scoring
```javascript
// scoring.js → scorePlay(equations, board, newTilesCount)
// Returns: { total: number, perEquation: [...], bingoBonus: number }
// ⚠️ NEVER use Scoring.computeScore() — it doesn't exist
```

### These two bugs existed across 3 files and took days to find:
- `validation.valid` → WRONG (always undefined). Use `validation.ok`
- `Scoring.computeScore()` → WRONG (throws error). Use `Scoring.scorePlay()`

---

## 4. AI ARCHITECTURE

### Decision Flow (ai-player.js → decideMove)
```
1. Detect ×9 threats on board
2. Check if bingo is feasible (has =, enough variety)
3. findBestPlay() — main search (85% of time budget)
4. Yoyo search (15% reserved, minimum 10s)
5. Fast bingo search (parallel path)
6. Grammar bingo search (parallel path)
7. blankAwarePick() — compare all results, prefer fewer blanks
8. ×9 defense check — avoid plays that create opponent ×9
9. Endgame adjustments (bag=0 emergency, bingo trap)
10. Return: play / swap / pass decision
```

### Time Budget
- **Normal game:** 180s total → findBestPlay 153s, yoyo 27s
- **Education mode:** 300s total → findBestPlay 255s, yoyo 45s
- **Yoyo per-set:** 3s (0-1 blanks), 5s (2), 8s (3), 10s (4+)

### Key Design Decisions
- **Blank preservation:** AI prefers plays using fewer blanks (saves for later)
- **= tile strategy:** Keep 1 for swap buffer, 2nd useful for chaining, dump 3rd+
- **Bingo-only mode:** First turns prioritize bingo search exclusively
- **Endgame bingo trap:** Check if post-bingo drawn tiles are playable

---

## 5. ×9 THREAT DETECTION

### What is ×9?
When an equation covers both 3E squares on the same line, the entire equation score is multiplied by 3×3 = 9.

### ×9 Lines (6 total)
Row 0, Row 7, Row 14, Col 0, Col 7, Col 14

### Threat Patterns (3 per line)
- Pattern (0,7): covers first 3E
- Pattern (7,14): covers second 3E
- Pattern (0,14): covers both 3E (full line)

### Detection Logic
- Both 3E endpoints must be empty
- `maxEmpty: 6` for half-line, `6` for full-line
- Needs a "hook" — existing tile on/near the line for opponent to connect
- Hook can be: between endpoints, adjacent to endpoint, OR beyond endpoint (e.g., col 8 for pattern 0-7)
- Subrim adjacency also counts as a hook

### False Positive Prevention
- Compare threats by `threatKey` = line type + index + endpoint coordinates
- A play is only flagged if it creates a NEW threat key that didn't exist before
- ⚠️ Do NOT compare by count or severity — these cause false positives

---

## 6. EDUCATION / VERIFY MODE

### How it works
1. Background search starts when player's turn begins
2. Uses deep-cloned tiles (CRITICAL: `.map(t => ({...t}))` not `.slice()`)
3. Player presses Verify → shows top 3 plays with scores
4. "🔍 Search 1 min more" button shown only when search timed out (>90% of budget used)
5. During extended search, pressing Verify shows results so far with "⏳ Still searching..." indicator

### ⚠️ BLANK MUTATION BUG (fixed, but easy to regress)
AI search temporarily mutates `tile.assigned` during permutation. If education passes references to player's actual rack tiles, blanks get permanently assigned. ALWAYS deep clone.

---

## 7. CHALLENGE SYSTEM

### AI challenges player's invalid play
- HARD mode: always catches easy errors, 99% catches math errors
- EASY mode: ~59% catch rate for math errors
- Reverts: tiles back to rack, score deducted, premium squares restored

### Player challenges AI
- Currently hardcoded `aiPlayWasValid = true` (AI always plays valid)
- If false, `revertPlay()` handles full rack by returning excess tiles to bag

### revertPlay() gotchas
- Rack may be full (refilled after play) → must return excess to bag first
- Must restore `premiumUsed = false` on reverted cells
- Must clear `tile.assigned = null` on blanks

---

## 8. UI / THEMES

### 12 Themes
Light: Modern, Physical Board, Playful, Capture, Sunset, Cherry Blossom, Arctic
Dark: Dark Mode, Ocean, Forest, Neon, Volcano

### Dark Theme Contrast Rules
- **Tentative tiles** (on board, not submitted): force dark text `#1e293b`
- **Committed tiles**: keep theme's light text (do NOT override)
- **Blank on board**: dark text on amber background
- **Score sheet**: dark background for totals row and table headers

### iPad Layout (700-1299px)
- Board fills 95vw, cells ~45px
- Tile Tracker and Timer bar visible (hidden by default, shown via media query)
- Desktop side panels hidden

### Mobile (<600px)
- Dynamic cell sizing: `(100vw - 18px) / 15`

---

## 9. TRASH TALK CHARACTERS

### สาธิตจุฬา (ริวจิ's school — the PLAYER's school)
| Character | Role | Lines |
|-----------|------|-------|
| ริวจิ (Ryuji) | Player | 8 |
| อรุษ | เพื่อนร่วมโรงเรียน, แซวริวจิ | 10 |
| พีซ | โค้ช/เพื่อน | 18 |
| เพลงรัก | ร้องเพลงแซว | 7 |
| ปุณ | ตกใจง่าย | 9 |
| จิณตา | จริงจัง | 13 |
| เทียน1/เทียน2 | คู่หู | 19 |
| ฟ้า | เงียบๆ | 9 |
| น้องโอโอ, น้องพัฟ, ต้นไม้, น้องรดา | น้องๆ | ~10 |
| โค้ชตี๋ | โค้ช, จ้องแล้วนะ | 60 |

### สาธิตองครักษ์ (rival school)
| Character | Lines |
|-----------|-------|
| กันเนอร์ | 9 |
| ข้าวหอม | 10 |

### คู่แข่งต่างโรงเรียน
| Character | School | Lines |
|-----------|--------|-------|
| มนภัทร | กรุงเทพพิทยา | 11 |
| คอปเตอร์ | เอี่ยมสุรีย์ | 12 |
| ไจ๋ไจ๋ | ? | 4 |

### Special phrases
- คนมีแต่ดวง (3 lines) — accusing luck
- โค้ชตี๋จ้องแล้วนะ (3 lines) — pressure from coach watching
- ปุณโดนฟรีซ (2 lines) — frozen with shock
- ×9 scare lines — only in BEHIND_200 and LEAD_BIG categories

### Context rules
- AI speaks AS the opponent → it trashes the PLAYER (ริวจิ/สาธิตจุฬา)
- อรุษ is ริวจิ's friend but still roasts him
- School rivalry: สาธิตจุฬา (player) vs สาธิตองครักษ์ (rival)
- ×9 mentions ONLY when score gap is large (intimidation)
- No encouragement — all lines are roasting/teasing

---

## 10. KNOWN LIMITATIONS & FUTURE WORK

### Search Accuracy
- 3-point gap in competition training is acknowledged
- "Search 1 min more" button available for extended search
- Per-anchor time cap spreads search across board but may miss optimal at specific anchors

### Not Implemented
- PvP save/resume
- AI bingo with 3+ BLANKs may still timeout
- Education top 3 plays only from main search path

### Regression-Prone Areas
1. `validation.ok` vs `.valid` — syntax-check.js catches this
2. Blank `.assigned` mutation — deep clone required everywhere
3. ×9 false positives — must compare by threatKey, not count
4. Dark theme contrast — easy to break with broad CSS overrides
5. Rack full crash — revertPlay must handle post-refill state

---

## 11. TESTING

### Quick syntax check (<1s)
```bash
node tests/syntax-check.js
```
Catches: parse errors, `validation.valid`, `Scoring.computeScore`

### Full test suite (40 tests, ~30s)
```bash
pip install playwright && playwright install chromium
python3 tests/run-tests.py
```
Tests: modules, scoring, validation, ×9 detection, yoyo, challenge, UI, themes

---

## 12. DEPLOYMENT

```bash
# GitHub Pages (auto-deploys from main branch)
git push origin main
```

### Build: None needed — plain HTML/JS/CSS, no bundler.

---

## 13. CRITICAL BUGS HISTORY (learn from these)

| Bug | Root Cause | Detection |
|-----|-----------|-----------|
| Yoyo NEVER worked | `validation.valid` + `Scoring.computeScore` | Simulation test |
| Bingo-fast NEVER worked | `validation.valid` | syntax-check.js |
| Bingo-grammar NEVER worked | `validation.valid` | syntax-check.js |
| Blank changes face | Education used `.slice()` (shallow copy) | User report |
| AI plays during player turn | No turn guard in executeAiDecision | User report |
| ×9 false positive | Compared by count/severity, not identity | User screenshot |
| Dark tiles invisible | Overly broad CSS `!important` override | User screenshot |
| Yoyo skipped | findBestPlay consumed entire budget | User report |
| Challenge crash | revertPlay on full rack | Simulation test |
| Premium not restored | Challenge revert didn't reset premiumUsed | Simulation test |
