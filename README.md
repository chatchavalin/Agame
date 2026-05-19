# A-Math Game

A web-based A-Math (Thai Scrabble-like math game) with AI opponent.

## How to run

### Quickest: open `index.html` in a browser

Just open `index.html`. Most things work. (localStorage may not persist on `file://`.)

### Better: serve over HTTP

**Python:**
```
python3 -m http.server 8000
```
Then visit `http://localhost:8000`.

**Or deploy to GitHub Pages:**
1. Create a new GitHub repo (public).
2. Upload everything in this folder (the `index.html` must be at repo root).
3. Settings → Pages → Source: `main` branch / root → Save.
4. Wait 30 seconds. Visit `https://<username>.github.io/<reponame>/`.

## File structure

```
amath-game/
├── index.html         Entry point
├── styles.css         All styling
└── js/                25 JS modules (vanilla JS, no build step)
    ├── constants.js   Game constants (board, tiles, rules)
    ├── utils.js       Math helpers (fractions, ID gen)
    ├── evaluator.js   Equation validator (fraction-exact math)
    ├── bag.js         Tile bag (draw, swap, shuffle)
    ├── rack.js        Player rack
    ├── board.js       15×15 board
    ├── scoring.js     Score calculation
    ├── placement.js   Move validation
    ├── ai-yoyo.js     AI YoYo strategy
    ├── ai-x9.js       AI ×9 threat detection
    ├── ai-swap.js     Brain 1: seed-keeping swap
    ├── ai-swap-brain2.js  Brain 2: probability-driven swap
    ├── ai-player.js   AI master decision-maker
    ├── sounds.js      Sound effects (Web Audio)
    ├── animations.js  Confetti, score popups
    ├── settings.js    Settings + localStorage
    ├── modes.js       Game mode handling
    ├── trash-talk.js  AI banter
    ├── score-sheet.js Score history + popup + live render
    ├── save-resume.js Save/load to file or localStorage
    ├── challenge.js   Challenge mechanic
    ├── tile-tracker.js Remaining tile counter
    ├── ui.js          DOM building
    ├── interactions.js Click/drag/drop handlers
    └── main.js        App entry, session lifecycle
```

## Features

- ประถม (70 tiles) / มัธยม (100 tiles) modes
- Player vs AI, AI vs AI modes
- Chess clock (configurable)
- 4 themes: Modern, Physical, Dark, Playful
- Save/resume games (localStorage + file export)
- Tile tracker (shows remaining tiles)
- Score sheet history
- Trash talk
- AI swap brains: Brain 1 (seed-keeping) or Brain 2 (probability)
- Double-click score to pause that player's timer
- Desktop 3-column layout (≥1100px) with live side panels
- Mobile-first responsive layout

## Game rules

Standard Thai A-Math:
- 15×15 board, premium squares (2T/3T/2E/3E)
- 8-tile rack
- First move passes through center ★
- Bingo (use all 8 tiles in one play) = +40 points
- YoYo (extend existing equation to 15 tiles, ×3E) = special
- BLANK and choice tiles (+/- and ×/÷)
- Swap forbidden when bag ≤ 5 tiles
- Game ends when someone empties rack with empty bag, OR after 6 consecutive non-scoring turns

## Controls

- **Tap tile in rack → tap board cell** to place
- **Tap placed tile** to return to rack
- **Drag** also works
- **Submit** to commit your turn
- **Reset** to undo placements before submitting
- **Pass** / **Swap** to skip
- **Double-click score box** to pause that player's timer
- **🤖 Auto** to let AI play your turn

## Browser support

Modern browsers (Chrome, Safari, Firefox, Edge). Tested on:
- iOS Safari
- Android Chrome
- Desktop Chrome/Firefox

Requires JavaScript. Uses no build tools, no frameworks, no CDN dependencies.
