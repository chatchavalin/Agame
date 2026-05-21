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
      // — Modern Thai slang —
      "ฟาดเรียบ 8 ตัวรวด เริ่ดมาก ✨",
      "ปังไม่ไหว Bingo จัดเต็ม 💥",
      "เริ่ดดด ลงเต็มแป้น ขิตเลยมั้ย? 💀",
      "ออร่า Bingo มาเต็ม ออร่าเธอไปไหน?",
      "565656 ฟาดเลย Bingo ขำขิตจริง 💀",
      "ตั้ลล้าก... ที่ Bingo ลงปุ๊บ ขำปั๊บ 🤭",
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
      // — Modern Thai slang —
      "เออ ปัง... แต่ครั้งเดียว อย่าหลง 😏",
      "Bingo เดียวอย่ามาออร่า รอตาฉันก่อน",
      "เริ่ดเลย... จดไว้ก่อน เดี๋ยวฉันฟาดคืน",
      "Bingo ครั้งเดียวก็ดีใจ? ตั้ลล้าก 🤭",
      // — Character flavor —
      "โค้ชตี๋ผงกหัว... 'ครั้งเดียวเอง อย่าเพิ่งดีใจ'",
      "หึหึ Bingo เดียว โค้ชตี๋ยังไม่ทันตื่นเต้น",
      "พีซ: 'อืม...โอเค ฟลุคไป' 🙄",
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
      // — Modern Thai slang —
      "ฟาดยับ คะแนนห่างขนาดนี้ เธอ delulu ป่าว? 💀",
      "ปังไป ห่างไป ตามไม่ทันหรอกจ้า",
      "ออร่าฉันท่วม อย่าฝืนเลย 565656",
      "ห่างชั้น G แล้ว เธอยังชั้นใต้ดินอยู่เลย 🤭",
    ],
    BEHIND_100: [
      "Just warming up. Bingo coming.",
      "เก็บคะแนนไว้ก่อนนะ จะมาเอาคืนทุกแต้ม",
      "Comeback mode activated. 😤",
      "อย่าเพิ่งดีใจ เกมยังไม่จบ",
      "Plot twist coming. Stay tuned.",
      "ขอคนเข้าใจหน่อย ฉันจะ comeback 😤",
      "อย่ามาเบียวนะ คะแนนยังไม่จบ",
      // — Modern Thai slang —
      "รอดู Bingo รอบหน้าก่อน จะฟาดให้ขิต 💀",
      "ปังกำลังโหลด... อย่าเพิ่งออร่า 😤",
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
      // — Modern Thai slang —
      "ขิตแล้วแหละ แต่จะฟื้นกลับมาฟาด ✨",
      "พลิกเกมแบบ Gen Alpha รอดู 🤚",
      "ออร่าฉันยังเหลือ comeback แน่ๆ 😤",
    ],
    AI_SWAP: [
      "Swap. Bad rack. Don't get cocky.",
      "เปลี่ยน tile รอบหน้าเอาคืน",
      "Refilling weapons. Hold on tight.",
      "RNG hates me this round. Just wait.",
      "Rack อ่อม ขอเปลี่ยนก่อน",
      // — Modern Thai slang —
      "Rack นี้ไม่ปัง ขอ swap หา rack ฟาด ✨",
      "ขิตกับ rack นี้ ขอเปลี่ยนหน่อย 💀",
    ],
    AI_PASS: [
      "Pass. Couldn't find anything good. ครั้งแรกในชีวิตเลย 😅",
      "Skipping. Your rack must be even worse.",
      "Pass... saving my brilliance for next turn.",
      "ปล่อยให้เธอเล่นก่อน เป็นมารยาท",
      // — Modern Thai slang —
      "Pass... ตาฉันเซฟพลัง รอตาหน้าฟาด",
      "ขิตอะ เล่นไม่ออก พักก่อน 🤭",
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
      // — Modern Thai slang —
      "Pass? ออร่าไปไหนหมดล่ะ 565656",
      "ขิตป่ะ คิดไม่ออก? อย่ามาเบียว 💀",
      "ปาสกระจาย ตั้ลล้าก... rack แย่จริงนะ 🤭",
      // — Character flavor —
      "โค้ชตี๋: 'แบบนี้ไปแข่งแย่แน่ๆ'",
      "ลืม pattern อีกแล้ว เฮ้อ! 🤦",
      "โค้ชตี๋ส่ายหัว... 'ใช่หรออออออ? pass จริงๆ?'",
      "หึหึ ปาส = ยอมแพ้สวยๆ",
      "พีซ: 'เห็นแป้นก็รู้ว่าเล่นได้นะ ทำไม pass?'",
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
      // — Modern Thai slang —
      "Swap = ยอมแพ้แบบสุภาพ เริ่ดเลย 😏",
      "เปลี่ยนทั้งกระดาน ก็ยังตามฉันไม่ทันหรอก",
      // — Character flavor —
      "โค้ชตี๋: 'swap = ยอมรับว่าอ่านเกมไม่ออก'",
      "โค้ชตี๋ตบโต๊ะเบาๆ 'แบบนี้ไปแข่งแย่แน่ๆ'",
      "จิณตา: 'swap อีกแล้ว... rack ดีนะแต่ไม่ใช้'",
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
      // — Modern Thai slang —
      "ฟาดยับ! ช่อง 3X กรี๊ดเรียกฉัน ✨",
      "ปังขนาดนี้ ขำขิตเลย 565656 💀",
      "ออร่า +500 เก็บคะแนนแบบ Gen Alpha",
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
      // — Modern Thai slang —
      "เร็วๆ หน่อย รอจน rack ฉันขิตแล้ว 🤭",
      "ตั้ลล้าก เร่งหน่อยนะ ✨",
      // — Character-flavored —
      "โค้ชตี๋กำลังจับตาดูอยู่นะ 👀",
      "หึหึ ตาเธอแล้วนะ",
      "พีซว่า... น่าจะเล่น Bingo ดูนะ",
      "ฟ้าเงียบๆ แต่จดทุกตาเลย",
    ],

    // === NEW: STALLING context ===
    // Fires when the player has been thinking for "too long" (e.g., every 30s).
    // The AI needles the player about taking forever. Character-flavored.
    STALLING: [
      // — โค้ชตี๋ (highlighted — most lines) —
      "โค้ชตี๋ไม่ถูกใจสิ่งนี้ 😒",
      "โค้ชตี๋นั่งรอจนเหงือกแห้งแล้วนะ",
      "โค้ชตี๋ส่ายหัว... คิดอะไรนานขนาดนั้น?",
      "โค้ชตี๋เริ่มหลับแล้วนะเนี่ย 😴",
      "โค้ชตี๋กระแอม... ตาใครนะ?",
      "โค้ชตี๋: 'pattern ง่ายๆ ก็ยังคิดไม่ออกอีกหรอ?' 🙄",
      "โค้ชตี๋มองนาฬิกาแล้วนะ ⏰",
      "โค้ชตี๋พูดในใจ: หึหึ มือใหม่ชัดๆ",
      "โค้ชตี๋อยากบอกว่า... ใช่หรออออออ? ที่จะคิดนานขนาดนี้?",
      "โค้ชตี๋: 'แบบนี้ไปแข่งแย่แน่ๆ'",
      "โค้ชตี๋ถอนหายใจ เฮ้อออ... 😮‍💨",
      "โค้ชตี๋แอบดูแป้นเธอ... เห็นชัดๆ ว่าเล่นได้ตั้งเยอะ",
      "โค้ชตี๋: 'จับเวลาจริงเดี๋ยวก็ขิต เร่งเร็ว!'",
      "โค้ชตี๋บอก ตาเธอจะหมดแล้วนะคนดี",
      "โค้ชตี๋นับ 1...2...3... ยังไม่เล่นอีก?",

      // — ใช่หรออออออ —
      "ใช่หรออออออ? ที่จะใช้เวลาคิดนานขนาดนี้? 😏",
      "ใช่หรออออออ? เห็นจดจ่ออยู่กับ rack แบบนี้",
      "เอ๊ะ ใช่หรออออออ? ลืม pattern ไปแล้วใช่ป่ะ",

      // — ลืม pattern —
      "ลืม pattern อีกแล้ว เฮ้อ! 🤦",
      "pattern พื้นฐานก็ยังลืม... เฮ้อ!",
      "ลืม pattern อีกแล้ว... ไปเรียนกับโค้ชตี๋ใหม่ดีกว่า",

      // — แบบนี้ไปแข่งแย่แน่ๆ —
      "แบบนี้ไปแข่งแย่แน่ๆ 😬",
      "ถ้าแข่งจริงป่านนี้หมดเวลาไปแล้ว แบบนี้ไปแข่งแย่แน่ๆ",
      "ช้าแบบนี้... แบบนี้ไปแข่งแย่แน่ๆ นะคนดี",

      // — หึหึ —
      "หึหึ ตันแล้วใช่ป่ะ 😏",
      "หึหึ เห็นไหมล่ะ เลือกไม่ถูก",
      "หึหึ rack สวย แต่หัวไม่ถึง?",
      "หึหึ ขำในใจอ่ะ คิดนานจัง",

      // — Other characters —
      "พีซเริ่มเขกหัวอยู่ในใจแล้วนะ",
      "พีซ: 'ทำไมไม่เล่น 15=15-0 ล่ะ ง่ายๆ' 💁",
      "ฟ้าเงียบมาก แต่สีหน้าบอกชัดเจน",
      "ฟ้าแอบดูเวลา แล้วก็มองหน้าโค้ชตี๋",
      "เทียน2 เริ่มกระดิกนิ้วรอแล้ว",
      "เทียน2: 'ตาฉันตาฉัน เล่นเสร็จซะที!'",
      "จิณตาแอบกระซิบบอกพีซ: 'นี่มันเล่น A-Math รึเล่นปริศนา?'",
      "จิณตาส่ายหัว... 'ง่ายๆ ก็คิดนาน'",
      "เพลงรักร้องในใจ: 'รอเธอออ... รอเธอออ...' 🎵",
      "เพลงรัก: 'นี่เธอจะเล่นตอนไหนคะ?' 🥺",
      "ปุณกระตุกเทียน2: 'ของฉันยังเล่นเร็วกว่าเลย'",
      "ปุณ: 'ตันแล้วบอกได้นะ ไม่ต้องเขิน'",
      "เทียน1 พึมพำ: 'หา pattern เจอยังคะ?'",
      "เทียน1 ขยับเก้าอี้ไปมา รอนาน",

      // — Mixed character commentary —
      "ทั้งโต๊ะมองเธออยู่นะ — โค้ชตี๋ พีซ ฟ้า เทียน1 เทียน2 จิณตา เพลงรัก ปุณ",
      "โค้ชตี๋: 'ใครๆ ก็รอ เธอเองที่ช้า'",
      "พีซกับฟ้ามองหน้ากัน... ส่ายหัวพร้อมกัน",
      "เทียน1เทียน2 จับมือกันรอลุ้น 'เล่นซะทีเถอะ!'",
      "จิณตา: 'โค้ชตี๋คะ ขอเริ่มคาบใหม่ก่อนเลยมั้ย เด็กคนนี้คิดนาน'",
    ],

    // ─────────────────────────────────────────────────────────────────
    // CHALLENGE_BUILDUP: AI suspects an invalid play, taunts BEFORE the reveal.
    // Fired 1-2 times to build suspense, then the REVEAL fires.
    // ─────────────────────────────────────────────────────────────────
    CHALLENGE_BUILDUP: [
      "เอ๊ะ... โค้ชตี๋ขอดูสมการนี้ก่อนนะ 🤔",
      "หึ่ม... แน่ใจนะว่าสมการนี้ถูก?",
      "โค้ชตี๋เอียงคอมอง... ใช่หรอออ?",
      "พีซแอบกระซิบ: 'นี่มันถูกจริงเหรอ?'",
      "ฟ้าจ้องสมการนิ่ง... รอนานเลย",
      "เทียน1: 'พี่ๆ ดูตรงนี้สิ ฉันว่ามันแปลกๆ'",
      "เทียน2: 'หือ? 5+3=9?? ลองคิดอีกที'",
      "จิณตา: 'โค้ชตี๋คะ ตรวจหน่อยค่ะ ดูแปลกๆ'",
      "ปุณ: 'รอแป๊บ ขอใช้เครื่องคิดเลขก่อน 🤓'",
      "เพลงรักร้อง: 'ผิดหรอออ ผิดหรอออ...' 🎵",
      "หึหึ... โค้ชตี๋เริ่มสงสัยแล้วนะ",
      "โค้ชตี๋ยิ้มมุมปาก... 'นี่มัน...'",
      "โค้ชตี๋นั่งคำนวณในใจ... 1+1=2... 2+3...",
      "ทั้งโต๊ะเริ่มหันมามอง... เกิดอะไรขึ้น?",
      "โค้ชตี๋: 'รอแป๊บนึง... ขอคำนวณก่อน'",
      "พีซเริ่มหัวเราะ: 'อ่าว... 5552'",
      "เทียน1เทียน2: 'พี่ๆ ดูดิ๊ ดูดิ๊'",
      "จิณตา ทำหน้านิ่ง... แอบยิ้มมุมปาก",
    ],

    // ─────────────────────────────────────────────────────────────────
    // CHALLENGE_REVEAL: AI calls out the invalid play. The "gotcha" moment.
    // ─────────────────────────────────────────────────────────────────
    CHALLENGE_REVEAL: [
      "🚨 CHALLENGE! โค้ชตี๋ขอท้าทาย สมการนี้ผิด!",
      "🚨 จับได้แล้ว! สมการไม่ถูกต้องนะ",
      "🚨 ไม่ผ่าน! โค้ชตี๋ขอ challenge",
      "🚨 หึ่ม... สมการผิด! ฉันท้าทาย",
      "🚨 Challenge! แบบนี้ไปแข่งแย่แน่ๆ จริงๆ",
      "🚨 เห็นมั้ย! บอกแล้วว่าผิด — challenge!",
      "🚨 โค้ชตี๋ challenge — ลืม pattern อีกแล้ว เฮ้อ! 🤦",
      "🚨 พีซ: 'challenge ไปเลยโค้ช ผิดชัดๆ!'",
      "🚨 ฟ้ากระซิบ: 'โค้ชคะ challenge เถอะ ผิดแน่ๆ'",
      "🚨 challenge! ทั้งโต๊ะรู้ว่ามันผิด",
      "🚨 ใช่หรออออออ ที่จะเล่นแบบนี้? challenge!",
      "🚨 หึหึ จับได้คาหนังคาเขา — challenge!",
    ],

    // ─────────────────────────────────────────────────────────────────
    // CHALLENGE_MISS: VERY rare — AI fails to spot an invalid play.
    // Only fires when difficulty allows a miss AND error was hard to spot.
    // ─────────────────────────────────────────────────────────────────
    CHALLENGE_MISS: [
      "เอ๊ะ... โค้ชตี๋ดูแล้ว... โอเค ผ่าน 🤔 (จริงๆนะ?)",
      "หึม... โค้ชตี๋ปล่อยให้ผ่าน คราวนี้นะ 😏",
      "พีซ: 'ดูเหมือนจะถูกนะโค้ช...' (โค้ชตี๋พยักหน้า)",
      "โค้ชตี๋: 'เอาเป็นว่าผ่านไปก่อน...' 🙃",
      "จิณตา: 'อืมม... น่าจะถูก' (ไม่แน่ใจเท่าไหร่)",
    ],

    // ─────────────────────────────────────────────────────────────────
    // AI_X9_PLAY: AI just played a ×9 multiplier (two 3E squares on one
    // equation = score × 9). Pure gloat material — fires 100% of the time
    // because ×9 plays are rare and dramatic.
    // ─────────────────────────────────────────────────────────────────
    AI_X9_PLAY: [
      "โดน x9 แน่นอน! 💥",
      "เสร็จฉันละ x9 รัวๆ 🔥",
      "หึหึ... x9 ของจริงนะ ลองทาน 😏",
      "โค้ชตี๋: 'นี่แหละความหมายของ x9 ของจริง'",
      "🚀 x9 รัวๆ ดูดีๆ นะ — แบบนี้แหละเทคนิค",
      "x9 มาแล้วจ้าาาา 🎯 จับให้อยู่!",
      "ใครว่ามุม 3E คุมยาก? โค้ชตี๋โชว์ให้ดู — x9!",
      "พีซ: 'โอ้โห โค้ช x9 เลยเหรอ?!' โค้ชตี๋: 'แน่นอน 😎'",
      "ฟ้า: 'นี่มัน x9 หรือเปล่า?' โค้ชตี๋: 'ใช่จ้ะ x9 จริงๆ'",
      "เทียน1เทียน2: 'พี่ๆ ดูดิ๊ x9!!!' 😱",
      "จิณตา: 'อย่าบอกนะว่า... x9?' โค้ชตี๋พยักหน้ายิ้ม 😏",
      "เพลงรักร้อง: 'x9 รัวๆ... x9 รัวๆ...' 🎵",
      "ปุณ: 'เครื่องคิดเลขยังไม่ทันคำนวณเลย — x9!'",
      "x9 ของโค้ชตี๋... แบบนี้แพ้แน่ๆ 💪",
      "🚨 x9 เข้าแล้ว! กดเสร็จฉันละ 💯",
      "ตรงนี้แหละ pattern x9 — ลืม pattern อีกแล้ว เฮ้อ! 🤦",
      "โค้ชตี๋กด x9 แบบสบายๆ — ฝึกมานานนะ",
      "ใช่หรออออออ? นี่มัน x9 ของแท้! 😤",
      "x9 แลนด์ดิ้งสำเร็จ — เป้าคะแนนเข้าทาง 🎯",
      "ทั้งโต๊ะตะลึง — x9 รัวๆ ของจริง",
    ],
  };

  // =========================================================================
  // BAG-EMPTY TAUNTS — Dynamic messages referencing the player's actual rack.
  // When the bag is empty, the AI can deduce the player's tiles perfectly
  // (total inventory − board − AI rack = player rack). The AI flexes this
  // knowledge with taunts that reveal the player's hand.
  // =========================================================================

  /**
   * Format a tile face for display in trash talk messages.
   * e.g. 'BLANK' → '?', '×/÷' → '×/÷', '5' → '5'
   */
  function faceDisplay(face) {
    if (face === 'BLANK') return '?';
    return face;
  }

  /**
   * Generate a bag-empty taunt message based on the player's actual rack.
   * Returns a string or null if no good taunt can be produced.
   * @param playerTiles  Array of tile objects [{face, type, ...}, ...]
   */
  function generateBagEmptyTaunt(playerTiles) {
    if (!playerTiles || playerTiles.length === 0) return null;

    const faces = playerTiles.map(t => faceDisplay(t.assigned || t.face));
    const faceStr = faces.join(' ');
    const operators = playerTiles.filter(t => t.type === 'op' || t.type === 'choice' || t.type === 'equals');
    const numbers = playerTiles.filter(t => t.type === 'num' || t.type === 'digit' || t.type === 'twodigit');
    const blanks = playerTiles.filter(t => t.type === 'blank');
    const equals = playerTiles.filter(t => t.type === 'equals' || (t.type === 'choice' && t.face === '+/-'));

    // Build a pool of possible taunts for this rack
    const pool = [];

    // --- Thai taunts ---
    pool.push('ฉันรู้นะ ว่าคุณมีเบี้ยอะไร 😏');
    pool.push('มีเบี้ย ' + faceStr + ' ใช่มั้ย? ฉันเห็นหมดแล้ว 👀');
    pool.push('ถุงหมดแล้ว ฉันรู้ว่าคุณถือ ' + faceStr + ' 💀');
    pool.push('เบี้ยหมดถุงแล้วนะ ฉันนับได้หมดเลย 🧮');
    pool.push('ไม่ต้องแอบ ฉันรู้ว่าคุณมี ' + faceStr + ' 😎');

    if (operators.length >= 4) {
      pool.push('มีเครื่องหมายเกินจะบิงโกได้หรอ? 55 😂');
      pool.push('เครื่องหมายเยอะขนาดนี้ ลำบากเลยนะ 💀');
      pool.push('oof เครื่องหมายล้นมือ จะลงยังไง? 🤭');
    }
    if (operators.length >= 3 && numbers.length <= 3) {
      pool.push('เครื่องหมายเยอะ ตัวเลขน้อย... ยากแล้วนะ 55');
    }
    if (blanks.length >= 2) {
      pool.push('BLANK 2 ตัว แต่จะมีประโยชน์มั้ยนะ? 🤔');
    }
    if (playerTiles.length <= 3) {
      pool.push('เหลือแค่ ' + playerTiles.length + ' ตัว? จบเร็วๆ นะ 😘');
    }
    if (equals.length === 0 && blanks.length === 0) {
      pool.push('ไม่มี = เลย? จะลงสมการได้ไง 555 🤣');
    }
    if (equals.length >= 3) {
      pool.push('= เยอะจัง ลง = = = ได้มั้ย? 555');
    }

    // --- English taunts ---
    pool.push("Bag's empty. I know your rack: " + faceStr + ' 👁️');
    pool.push("Nice tiles you got there... oh wait, I can see them all. " + faceStr);
    pool.push("No more bag. I see everything: " + faceStr + " 😏");

    if (operators.length >= 4) {
      pool.push("That many operators? Good luck making a bingo lol 😂");
    }
    if (playerTiles.length <= 3) {
      pool.push("Only " + playerTiles.length + " tiles left? This'll be quick 💨");
    }

    // Pick a random one
    return U.randomChoice(pool);
  }

  // Avoid repetition: queue of last 5 messages shown
  const recentMessages = [];
  const RECENT_CAP = 5;

  // Fire rate: 20% per turn per spec
  const FIRE_CHANCE = 0.20;

  /**
   * Detect Thai characters in a string (Unicode range U+0E00–U+0E7F).
   */
  const THAI_RE = /[\u0E00-\u0E7F]/;
  function hasThai(s) { return THAI_RE.test(s); }

  /**
   * Read the user's trash-talk language preference.
   * Returns 'th' | 'en' | 'both'. Defaults to 'th' if settings unavailable.
   */
  function getLanguagePreference() {
    try {
      if (window.AMath.settings && window.AMath.settings.get) {
        const lang = window.AMath.settings.get('trashTalkLanguage');
        if (lang === 'th' || lang === 'en' || lang === 'both') return lang;
      }
    } catch (e) { /* fallback */ }
    return 'th';
  }

  /**
   * Filter a message pool by the current language preference.
   *   'th':   keep messages containing Thai characters (Thai-only OR mixed)
   *   'en':   keep messages with NO Thai characters (pure English)
   *   'both': keep all
   */
  function filterByLanguage(pool, lang) {
    if (lang === 'both') return pool;
    if (lang === 'en') return pool.filter(m => !hasThai(m));
    return pool.filter(m => hasThai(m));  // 'th'
  }

  /**
   * Selects a message for the given context (or null if none should fire this turn).
   * @param context: e.g., 'BG_AI', 'OPP_PASS', etc.
   * @param force: if true, skip the fire-chance gate (use for special events)
   *
   * Most contexts use FIRE_CHANCE (20%) — keeps the chatter from being noisy.
   * STALLING gets a much higher rate because the player is already taking
   * unusually long; staying silent across multiple 30s buckets would feel like
   * the feature is broken.
   */
  function selectMessage(context, force) {
    // Challenge sequence messages MUST fire (drama interruption — no skipping).
    // STALLING fires often (70%). Everything else uses the default FIRE_CHANCE.
    let chance = FIRE_CHANCE;
    if (context === 'STALLING') chance = 0.70;
    else if (context === 'CHALLENGE_BUILDUP') chance = 1.0;
    else if (context === 'CHALLENGE_REVEAL') chance = 1.0;
    else if (context === 'CHALLENGE_MISS') chance = 1.0;
    else if (context === 'AI_X9_PLAY') chance = 1.0;
    if (!force && Math.random() > chance) return null;

    const rawPool = LIBRARY[context] || LIBRARY.NEUTRAL;
    if (!rawPool || rawPool.length === 0) return null;

    // Apply language filter
    const lang = getLanguagePreference();
    let pool = filterByLanguage(rawPool, lang);
    // Fallback: if the language filter empties the pool for this context,
    // try the OTHER language so the AI doesn't fall silent on a rare context.
    if (pool.length === 0) pool = rawPool;

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
    if (event === 'stalling') return 'STALLING';
    if (event === 'challenge_buildup') return 'CHALLENGE_BUILDUP';
    if (event === 'challenge_reveal') return 'CHALLENGE_REVEAL';
    if (event === 'challenge_miss') return 'CHALLENGE_MISS';
    if (event === 'ai_x9') return 'AI_X9_PLAY';
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
   * state.force, if true, skips the random fire-chance gate (e.g., for the
   * first stalling-needle fire of a player's turn, which we always want shown).
   */
  function fireForEvent(event, state) {
    // Special case: bag-empty taunt uses dynamic messages based on player's rack
    if (event === 'bag_empty_taunt') {
      // Always fire (100% chance) — this is a dramatic moment
      const msg = generateBagEmptyTaunt(state.playerTiles);
      if (msg) {
        // Apply language filter: if the user only wants Thai or English,
        // regenerate until we get a matching message (up to 10 tries)
        const lang = getLanguagePreference();
        if (lang === 'both' || (lang === 'th' && hasThai(msg)) || (lang === 'en' && !hasThai(msg))) {
          showToast(msg);
        } else {
          // Wrong language — retry
          for (let i = 0; i < 10; i++) {
            const alt = generateBagEmptyTaunt(state.playerTiles);
            if (!alt) break;
            if ((lang === 'th' && hasThai(alt)) || (lang === 'en' && !hasThai(alt))) {
              showToast(alt);
              return;
            }
          }
          // Fallback: show whatever we got
          showToast(msg);
        }
      }
      return;
    }

    const ctx = pickContext(event, state);
    const force = !!(state && state.force);
    const msg = selectMessage(ctx, force);
    if (msg) showToast(msg);
  }

  window.AMath = window.AMath || {};
  window.AMath.trashTalk = {
    fireForEvent: fireForEvent,
    selectMessage: selectMessage,
    showToast: showToast,
  };
})();
