# A-Math Puzzle Simulator — How to Use

This folder lets you generate captured-puzzles offline (on your computer)
and import them into your A-Math web app's bank.

## What you need

- **Node.js** (any recent version). Check with: `node --version`
- The Agame repo cloned: `git clone https://github.com/chatchavalin/Agame`

## Step 1: Run the simulator

```bash
cd Agame
node sim/run-simulator.js 50 > captured.json
```

The number (`50`) is how many games to simulate. Each game runs the AI at
full search depth (180 seconds per turn, same as live PvA), so a game
takes 5–10 minutes. **50 games ≈ 4–8 hours of CPU time.**

For a quick test, start with `node sim/run-simulator.js 3`.

The simulator prints progress to stderr. When done, `captured.json` will
contain an array of puzzles in the exact format the web app's bank expects.

## Step 2: Import into the web app

1. Open this URL in your browser:
   ```
   https://chatchavalin.github.io/Agame/sim/import.html
   ```
   (⚠️ must be the same domain as the game — `https://chatchavalin.github.io`)

2. Open `captured.json` in any text editor, copy the entire contents.

3. Paste into the textarea, click **📥 Import**.

4. Go to https://chatchavalin.github.io/Agame/puzzle.html — the new puzzles
   are now available.

## Other operations

The same importer page lets you:
- **Export** your current bank to a JSON file (backup before bulk import)
- **Replace All** (wipe and import fresh)
- **Clear** all puzzles

## How the simulator picks puzzles to capture

For each player-turn in each game, the simulator:
1. Runs the AI at full depth to get the top-3 best plays
2. Only captures positions where:
   - Bag has fewer than 25 tiles
   - At least one of the top-3 best plays is a BINGO or YOYO
   - A "weak player" pick scores at least 5 points below the best play
3. Records: board state, rack, the top-3 best plays, scores

The capture format matches puzzle-recorder.js exactly, so manually-recorded
puzzles from real PvA play and simulator puzzles coexist in the same bank.
