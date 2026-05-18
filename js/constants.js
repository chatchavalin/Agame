/**
 * A-Math Game — Constants
 *
 * All unchanging game data. Sourced from Master Spec v1.3.
 * If you need to change game rules, this is usually the place.
 */

// =============================================================================
// TILE INVENTORY (Master Spec §1.2)
// =============================================================================

/**
 * The 100 tiles in the bag.
 * Each entry: { face, count, points, type }
 *
 * type values:
 *   'digit'  = single-digit number tile (0-9), can combine to form multi-digit
 *   'twodigit' = standalone 2-digit number tile (10-20), cannot combine
 *   'op'     = operator (+, -, ×, ÷)
 *   'choice' = +/- or ×/÷ (choose one when placing)
 *   'equals' = =
 *   'blank'  = BLANK
 */
const TILE_INVENTORY = [
  // Single-digit numbers (0-9)
  { face: '0',  count: 5, points: 1, type: 'digit' },
  { face: '1',  count: 6, points: 1, type: 'digit' },
  { face: '2',  count: 6, points: 1, type: 'digit' },
  { face: '3',  count: 5, points: 1, type: 'digit' },
  { face: '4',  count: 5, points: 2, type: 'digit' },
  { face: '5',  count: 4, points: 2, type: 'digit' },
  { face: '6',  count: 4, points: 2, type: 'digit' },
  { face: '7',  count: 4, points: 2, type: 'digit' },
  { face: '8',  count: 4, points: 2, type: 'digit' },
  { face: '9',  count: 4, points: 2, type: 'digit' },

  // Two-digit standalone (10-20)
  { face: '10', count: 2, points: 3, type: 'twodigit' },
  { face: '11', count: 1, points: 4, type: 'twodigit' },
  { face: '12', count: 2, points: 3, type: 'twodigit' },
  { face: '13', count: 1, points: 6, type: 'twodigit' },
  { face: '14', count: 1, points: 4, type: 'twodigit' },
  { face: '15', count: 1, points: 4, type: 'twodigit' },
  { face: '16', count: 1, points: 4, type: 'twodigit' },
  { face: '17', count: 1, points: 6, type: 'twodigit' },
  { face: '18', count: 1, points: 4, type: 'twodigit' },
  { face: '19', count: 1, points: 7, type: 'twodigit' },
  { face: '20', count: 1, points: 5, type: 'twodigit' },

  // Operators
  { face: '+',   count: 4, points: 2, type: 'op' },
  { face: '-',   count: 4, points: 2, type: 'op' },
  { face: '+/-', count: 5, points: 1, type: 'choice' },
  { face: '×',   count: 4, points: 2, type: 'op' },
  { face: '÷',   count: 4, points: 2, type: 'op' },
  { face: '×/÷', count: 4, points: 1, type: 'choice' },

  // Equals
  { face: '=', count: 11, points: 1, type: 'equals' },

  // Blank
  { face: 'BLANK', count: 4, points: 0, type: 'blank' },
];

// =============================================================================
// BOARD LAYOUT (Master Spec §2.2)
// =============================================================================

/**
 * Premium square layout, 15×15.
 * Verified against physical A-Math board (รุ่นทั่วไป มัธยม-โอเพ่น).
 *
 * Values:
 *   '3E' = Triple Equation (red)
 *   '2E' = Double Equation (yellow)
 *   '3T' = Triple Tile (blue)  — center (7,7) has star
 *   '2T' = Double Tile (orange)
 *   ''   = plain square
 */
const PREMIUM_SQUARES = [
  /* row  0 */ ['3E','','','2T','','','','3E','','','','2T','','','3E'],
  /* row  1 */ ['','2E','','','','3T','','','','3T','','','','2E',''],
  /* row  2 */ ['','','2E','','','','2T','','2T','','','','2E','',''],
  /* row  3 */ ['2T','','','2E','','','','2T','','','','2E','','','2T'],
  /* row  4 */ ['','','','','3T','','','','','','3T','','','',''],
  /* row  5 */ ['','3T','','','','3T','','','','3T','','','','3T',''],
  /* row  6 */ ['','','2T','','','','2T','','2T','','','','2T','',''],
  /* row  7 */ ['3E','','','2T','','','','3T','','','','2T','','','3E'],
  /* row  8 */ ['','','2T','','','','2T','','2T','','','','2T','',''],
  /* row  9 */ ['','3T','','','','3T','','','','3T','','','','3T',''],
  /* row 10 */ ['','','','','3T','','','','','','3T','','','',''],
  /* row 11 */ ['2T','','','2E','','','','2T','','','','2E','','','2T'],
  /* row 12 */ ['','','2E','','','','2T','','2T','','','','2E','',''],
  /* row 13 */ ['','2E','','','','3T','','','','3T','','','','2E',''],
  /* row 14 */ ['3E','','','2T','','','','3E','','','','2T','','','3E'],
];

const BOARD_SIZE = 15;
const CENTER_CELL = { row: 7, col: 7 };  // The 3T star square

// =============================================================================
// CORE GAME RULES (Master Spec §1)
// =============================================================================

const RACK_SIZE = 8;
const BINGO_BONUS = 40;
const SWAP_FORBIDDEN_BAG_THRESHOLD = 5;       // Can't swap when bag ≤ this
const CONSECUTIVE_NON_SCORING_TURNS_TO_END = 6;  // 3 per player → game ends

// =============================================================================
// AI STRATEGY THRESHOLDS (Master Spec §3)
// =============================================================================

const AI_PHASE_THRESHOLDS = {
  PHASE_1_PLAY_COUNT: 4,                // First 4 AI plays = Phase 1
  COMEBACK_TRIGGER_DEFICIT: 100,        // AI behind > this → Comeback mode
  DEEP_COMEBACK_TRIGGER_DEFICIT: 200,   // AI behind > this → Deep Comeback
  COMEBACK_EXIT_DEFICIT: 70,            // Comeback → Normal when deficit ≤ this
  DEEP_COMEBACK_EXIT_DEFICIT: 100,      // Deep Comeback → Comeback when deficit ≤ this
  ENDGAME_BAG_THRESHOLD: 5,             // Bag ≤ this → Endgame phase
};

const AI_DIFFICULTY = {
  EASY: { name: 'Easy', challengeRate: 0.50 },
  MEDIUM: { name: 'Medium', challengeRate: 0.80 },
  HARD: { name: 'Hard', challengeRate: 1.00 },
};

const AI_BLUFF_CHANCE = 0.20;  // 20% per turn when deficit > 200 (Master Spec §10)

// =============================================================================
// TIME BUDGETS — DEFAULTS (Master Spec §3.4)
// All times are user-configurable via Settings.
// =============================================================================

const DEFAULT_SETTINGS = {
  difficulty: 'HARD',                   // 'EASY' | 'MEDIUM' | 'HARD'
  normalTurnLimitSec: 60,               // Normal AI turn time limit
  crucialTurnLimitSec: 120,             // Comeback/Endgame turn limit
  extensionTimeSec: 90,                 // Extension granted by popup
  extensionTriggerDeficit: 150,         // Deficit needed for extension popup
  chessClockMinutes: 22,                // Game-total time per player
  timePenaltyPerMinuteOver: 10,         // Points lost per minute over chess clock
  firstMoveDrawCeremony: false,         // Show tile-draw ceremony at game start
  trashTalkChance: 0.20,                // Chance per turn for trash-talk message
};

// =============================================================================
// TRASH-TALK CONTEXTS (Trash-talk Library v1.2)
// =============================================================================

const TRASH_TALK_CONTEXTS = [
  'BG_AI',           // AI just bingoed
  'BG_OPP',          // Opponent just bingoed
  'LEAD_BIG',        // AI leading > 100
  'BEHIND_100',      // AI behind 100-200
  'BEHIND_200',      // AI behind > 200
  'AI_SWAP',         // AI swapped
  'AI_PASS',         // AI passed
  'OPP_PASS',        // Opponent passed
  'OPP_SWAP',        // Opponent swapped
  'AI_CHAL_WIN',     // AI challenged correctly
  'AI_CHAL_LOSE',    // AI's challenge failed
  'OPP_CHAL_WIN',    // Opponent challenged AI correctly
  'OPP_CHAL_LOSE',   // Opponent's challenge failed
  'BLUFF_SUCCESS',   // AI's bluff went unchallenged
  'HIGH_SCORE_PLAY', // AI scored ≥50 pts
  'NEUTRAL',         // Fallback
];

// =============================================================================
// GAME MODES (Master Spec §20, §21)
// =============================================================================

const GAME_MODES = {
  PLAYER_VS_AI: 'player_vs_ai',
  AI_VS_AI: 'ai_vs_ai',
};

// =============================================================================
// EXPOSE TO GLOBAL SCOPE
// (Since we're not using modules, attach to window for use in other files)
// =============================================================================

window.AMath = window.AMath || {};
window.AMath.constants = {
  TILE_INVENTORY,
  PREMIUM_SQUARES,
  BOARD_SIZE,
  CENTER_CELL,
  RACK_SIZE,
  BINGO_BONUS,
  SWAP_FORBIDDEN_BAG_THRESHOLD,
  CONSECUTIVE_NON_SCORING_TURNS_TO_END,
  AI_PHASE_THRESHOLDS,
  AI_DIFFICULTY,
  AI_BLUFF_CHANCE,
  DEFAULT_SETTINGS,
  TRASH_TALK_CONTEXTS,
  GAME_MODES,
};
