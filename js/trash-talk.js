/**
 * A-Math Game — Trash-Talk System
 *
 * Selects context-aware AI messages from the library and shows them as toasts.
 * Implements selection logic from Trash-Talk Library v1.2.
 */

(function () {
  const U = window.AMath.utils;

  // Message library by context (from Trash-Talk Library v1.2)
  const LIBRARY = {
    BG_AI: [
      "Bingo! 555 too easy. 😎",
      "เอาไป +40 ฟรีๆ ไม่อยากเล่นแล้วเหรอ?",
      "All 8 tiles, all 8 reasons you're losing.",
      "Bingo อีกแล้ว... อย่าให้ต้องนับเลย",
      "ใส่หมดแป้น easy ๆ skill issue?",
      "ชีเสิร์ฟ Bingo! 💅",
      "Bingo. 67. 🤚",
      "โฮ่งมาก! +40 จบ",
      "Sigma bingo. You're cooked. 🔥",
      "Bussin' bingo. No cap.",
      "I'm the GOAT of A-Math, bet.",
      "Gyatt! All 8 tiles down!",
      "Aura points: +1000. Yours: -1000.",
      "Sheesh. That bingo hits different.",
      "Chad move. Bingo locked.",
    ],
    BG_OPP: [
      "Lucky tiles. Won't happen again.",
      "Hmm นั่นแค่ฟลุค รอบหน้าฉันโชว์บ้าง",
      "OK, OK, ฉันยอมรับ rack ดีจริง",
      "First time? Don't get used to it.",
      "Bingo เดียวก็จะมาคุย? อย่ามาเบียวนะ",
      "OK that had some rizz. Won't be enough though.",
      "Mid bingo. I'll do better.",
      "Bet. My turn next.",
    ],
    LEAD_BIG: [
      "ห่างไกลเหลือเกิน... ตามไม่ทันแน่",
      "Maybe try a different game? This one's mine.",
      "Score gap = your effort gap.",
      "ห่างขนาดนี้... จะถอดใจรึยัง? 😏",
      "I'd let you win but my rack won't let me.",
      "Comeback impossible. ยอมแพ้เถอะ",
      "นำห่างจบ ไม่ต้องลุ้น",
      "ชั้น G อย่าหวังจะตามทัน",
      "Comeback time? Six. Seven. 🤚",
      "You're cooked, Unc. 🔥",
      "Delulu if you think you can come back.",
      "Pure sigma play. You're done.",
      "L incoming. Take the L gracefully.",
    ],
    BEHIND_100: [
      "Just warming up. Bingo coming.",
      "เก็บคะแนนไว้ก่อนนะ จะมาเอาคืนทุกแต้ม",
      "Comeback mode activated. 😤",
      "อย่าเพิ่งดีใจ เกมยังไม่จบ",
      "Plot twist coming. Stay tuned.",
      "ขอคนเข้าใจหน่อย ฉันจะ comeback 😤",
      "อย่ามาเบียวนะ คะแนนยังไม่จบ",
    ],
    BEHIND_200: [
      "Big deficit, bigger comeback. มาดูกัน",
      "Going for the ×9 play. Pray for me.",
      "เกมนี้ยังไม่ตัดสิน รอบหน้าฉันสวยแน่",
      "Time for desperate measures. 😈",
      "อย่าวางใจนะ เกมพลิกได้เสมอ",
      "อ่อมมาก แต่ยังไม่จบ 😤",
      "67. 67. 67. (จะปั่นให้กลัว) 🤚",
      "I'm about to crash out. 💀",
      "Skibidi bingo loading...",
      "Don't worry, I'm delulu enough to win.",
    ],
    AI_SWAP: [
      "Swap. Bad rack. Don't get cocky.",
      "เปลี่ยน tile รอบหน้าเอาคืน",
      "Refilling weapons. Hold on tight.",
      "RNG hates me this round. Just wait.",
      "Rack อ่อม ขอเปลี่ยนก่อน",
    ],
    AI_PASS: [
      "Pass. Couldn't find anything good. ครั้งแรกในชีวิตเลย 😅",
      "Skipping. Your rack must be even worse.",
      "Pass... saving my brilliance for next turn.",
      "ปล่อยให้เธอเล่นก่อน เป็นมารยาท",
    ],
    OPP_PASS: [
      "ปาส? Already giving up?",
      "Can't find a play? Skill issue.",
      "Pass = free turn for me. Thanks!",
      "เห็นเดินถอย... rack แย่หรอ? 😏",
      "555 ผ่าน? ตันแล้วหรอ?",
      "ปาส? ชั้น G จริงๆ 😏",
      "Pass = L. Take notes.",
      "Mid play. Or no play. Same energy.",
      "Skibidi pass. 💀",
      "Just put the fries in the bag and pass already.",
      "Dog water rack? Skill issue, Unc.",
    ],
    OPP_SWAP: [
      "Swapping? Sounds like a confession.",
      "เปลี่ยน tile? แสดงว่ามือไม่ดีแหละ",
      "Free turn for me. Thanks for the gift.",
      "Couldn't make anything? นั่นแหละ skill",
      "Swap = หวานนะ บอกว่ามือดีไง 😏",
      "Swap แล้วยังจะแพ้อีกมั้ย? 67. 🤚",
      "Dog water rack? Swap won't save you.",
      "Mid tiles, mid swap. Tragic.",
    ],
    HIGH_SCORE_PLAY: [
      "Premium squares were calling my name. 💰",
      "50+ แต้มในตาเดียว Easy game",
      "That's how you score. Take notes.",
      "Triple multiplier go brrrrr",
      "เก็บแต้มเยอะๆ ตามเก็บนะ 😏",
      "โฮ่งมาก! Triple multiplier 💎",
      "Bussin' play. 50+ points. No cap.",
      "Sheesh! That score hits different.",
      "GYATT! Premium squares said hi.",
      "Sigma score. Aura +500.",
    ],
    NEUTRAL: [
      "ยังเล่นอยู่นะ",
      "Next move incoming...",
      "Plotting my next masterpiece.",
      "Game on. คิดให้ดีนะ",
      "Tick tock... your turn.",
      "67. 🤚",
      "Skibidi. (No reason.) 💀",
      "Bet. Your turn.",
      "It's giving 'you need to play already.'",
    ],
  };

  // Avoid repetition: queue of last 5 messages shown
  const recentMessages = [];
  const RECENT_CAP = 5;

  // Fire rate: 20% per turn per spec
  const FIRE_CHANCE = 0.20;

  /**
   * Selects a message for the given context (or null if none should fire this turn).
   * @param context: e.g., 'BG_AI', 'OPP_PASS', etc.
   * @param force: if true, skip the 20% gate (use for special events)
   */
  function selectMessage(context, force) {
    if (!force && Math.random() > FIRE_CHANCE) return null;

    const pool = LIBRARY[context] || LIBRARY.NEUTRAL;
    if (!pool || pool.length === 0) return null;

    // Filter out recently used
    const candidates = pool.filter((m) => !recentMessages.includes(m));
    const finalPool = candidates.length > 0 ? candidates : pool;

    const msg = U.randomChoice(finalPool);

    recentMessages.push(msg);
    if (recentMessages.length > RECENT_CAP) recentMessages.shift();

    return msg;
  }

  /**
   * Determines applicable context based on game state.
   * @param event: 'ai_bingo' | 'ai_play' | 'ai_pass' | 'ai_swap' | 'opp_bingo' | 'opp_pass' | 'opp_swap'
   * @param state: { aiScore, playerScore, lastScore }
   */
  function pickContext(event, state) {
    const deficit = state.playerScore - state.aiScore;

    if (event === 'ai_bingo') return 'BG_AI';
    if (event === 'opp_bingo') return 'BG_OPP';
    if (event === 'ai_pass') return 'AI_PASS';
    if (event === 'ai_swap') return 'AI_SWAP';
    if (event === 'opp_pass') return 'OPP_PASS';
    if (event === 'opp_swap') return 'OPP_SWAP';
    if (event === 'ai_play') {
      if (state.lastScore && state.lastScore >= 50) return 'HIGH_SCORE_PLAY';
      if (deficit > 200) return 'BEHIND_200';
      if (deficit > 100) return 'BEHIND_100';
      if (deficit < -100) return 'LEAD_BIG';
    }
    return 'NEUTRAL';
  }

  /**
   * Show a toast notification with the message. Auto-dismiss after 3 sec.
   */
  function showToast(message) {
    const existing = document.querySelector('.trash-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'trash-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Fade in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Convenience: pick context + message + display in one call.
   */
  function fireForEvent(event, state) {
    const ctx = pickContext(event, state);
    const msg = selectMessage(ctx);
    if (msg) showToast(msg);
  }

  window.AMath = window.AMath || {};
  window.AMath.trashTalk = {
    fireForEvent: fireForEvent,
    selectMessage: selectMessage,
    showToast: showToast,
  };
})();
