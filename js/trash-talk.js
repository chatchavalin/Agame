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
      "ใส่หมดเบี้ย easy ๆ skill issue?",
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
      "เริ่ดดด ลงหมดเบี้ย ขิตเลยมั้ย? 💀",
      "ออร่า Bingo มาเต็ม ออร่าเธอไปไหน?",
      "565656 ฟาดเลย Bingo ขำขิตจริง 💀",
      "ตั้ลล้าก... ที่ Bingo ลงปุ๊บ ขำปั๊บ 🤭",
      // — ตัวละคร —
      "น้องรดาเห็นท่านี้คงร้อง ว้าวววว! 🌟",
      "ต้นไม้เห็นคงพยักหน้า... Bingo แบบโปรเลย 🌳",
      "น้องพัฟจดไว้นะ นี่แหละท่า Bingo ตัวจริง ✍️",
      "น้องโอโอเห็นคงตาโต Bingo สวยขนาดนี้! 😲",
      "ริวจิ! Bingo แบบนี้ มนภัทรเห็นคงร้องไห้เลย 😏",
      "ไจ๋ไจ๋เห็นท่านี้คงต้องกลับไปซ้อมใหม่ตั้งแต่ต้น 😏",
      "มนภัทร กรุงเทพพิทยา เห็น Bingo นี้คงปิดจอไปเลย 💀",
      "Bingo ระดับนี้ คอปเตอร์ก็ต้องก้มหัวให้ ✨",
      "กันเนอร์เห็น Bingo นี้คงนั่งนิ่งไปเลย 😶",
      "ข้าวหอมกับกันเนอร์เห็น Bingo นี้คงมองหน้ากัน 💀",
      "อรุษ: 'ริวจิ โดน Bingo แบบนี้ เสียชื่อสาธิตจุฬา' 😅",
      "กันเนอร์กับข้าวหอม สาธิตองครักษ์ ส่ง Bingo มาแซว 🔥",
      "โค้ชตี๋พยักหน้า 'แบบนี้สิ ถึงจะเรียกว่า Bingo' 😎",
      "พีซ: 'Bingo ของฉันสวยกว่านี้อีก' ...จริงเหรอ? 🙄",
      "ฟ้าจดไว้ในสมุด 'วันนี้โดน Bingo อีกแล้ว' 📕",
      "เทียน2: 'พี่ๆ ทำไม Bingo ทุกเกมเลย ไม่แฟร์!' 😤",
      "ปุณนับนิ้ว... 'Bingo ครั้งที่เท่าไหร่แล้วนะ?'",
      "โอโอตะโกน ชาเล้นนนนนนนนน...ดังลั่นห้อง 📢",
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
      // — ตัวละคร —
      "ต้นไม้เห็นคงยิ้ม... เพราะรอตาเขา 🌳",
      "น้องพัฟเห็นก็ทำได้ เธอทำได้ก็ไม่แปลก ✍️",
      "น้องรดาเห็นยังต้องยอม... ครั้งเดียวนะ 😏",
      "ริวจิ Bingo สวยมาก! เอาท่านี้ไปใช้กับกันเนอร์ได้เลย 🎯",
      "มนภัทรเห็นคงต้องระวังตัวแล้ว 😏",
      "ข้าวหอม: 'ฟลุคชัดๆ ตาเดียวอย่าดีใจ' 🙄",
      "อรุษ: 'Bingo ได้แล้ว อย่าเพิ่งอวด ทำให้ได้ทุกเกมก่อน' 😏",
      "โค้ชตี๋ถอนหายใจ 'โอเค... ครั้งเดียวนะ อย่าเพิ่งดีใจ' 😒",
      "คอปเตอร์ เอี่ยมสุรีย์ ยังทำได้เลย ไม่แปลกใจ 🙄",
      "เทียน1: 'หา?! Bingo จริงเหรอ ตรวจอีกทีสิ!'",
      "จิณตาหรี่ตาดู 'ฟลุค... ฟลุคแน่ๆ' 🤨",
      "คนมีแต่ดวง Bingo ครั้งเดียวอย่ามาอวด 🍀",
      "เพลงรักขยับแมส 2 ที ส่ายหัวหงึกๆ 😏",
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
      // — ตัวละคร —
      "น้องรดายังเล่นสนุกกว่านี้อีก ยอมรับเถอะ 😏",
      "ต้นไม้สอนมาดี นำห่างแบบนี้ไม่มีใครตามทัน 🌳",
      "น้องโอโอเห็นสกอร์นี้คงหัวเราะเลย 555",
      "ริวจิ นำห่างขนาดนี้ แม้แต่กันเนอร์ก็ตามไม่ทัน 🔥",
      "ข้าวหอมเห็นสกอร์คงเงียบไปเลย... หายาก 😏",
      "อรุษ: 'ริวจิ แพ้ขนาดนี้ อย่าบอกใครว่ามาจากสาธิตจุฬา' 💀",
      "กันเนอร์: 'สาธิตจุฬาแพ้แบบนี้ สาธิตองครักษ์ยิ้มเลย' 555",
      "เล่นแบบนี้ มนภัทรเจอก็ต้องยกธงขาว 🏳️",
      "นำขนาดนี้ กรุงเทพพิทยาทั้งโรงเรียนมาก็ตามไม่ทัน 😏",
      "คอปเตอร์กลับไปเอี่ยมสุรีย์ซ้อมใหม่ดีกว่า 555",
      "คอปเตอร์เห็นสกอร์นี้คงปิดเกมหนีเลย 555",
      "โค้ชตี๋: 'นำขนาดนี้ ไปนอนได้เลย ไม่ต้องเล่นต่อ' 😴",
      "พีซมองสกอร์ แล้วมองหน้าเธอ แล้วก็ส่ายหัว 🙄",
      "เทียน1เทียน2 ถามพร้อมกัน 'พี่ยอมแพ้ยังคะ?' 🤭",
      "จิณตา: 'สกอร์ห่างขนาดนี้... น่าอายนะ'",
      "เพลงรักร้องเพลงส่ง... 'ลาก่อนนน~' 🎵",
      // — ×9 ขู่ —
      "นำอยู่แล้ว... ถ้าได้ ×9 อีก จบเกมเลย 😈",
      "×3 สมการ สองฝั่งยังว่าง เธอเปิดให้ฉันเองนะ 💀",
      "นำอยู่แบบนี้ ×9 แค่ bonus ที่ไม่ต้องการแล้ว 555",
      "row 0, row 14 ฉันจ้องอยู่นะ... ระวังดีๆ 👀",
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
      // — ตัวละคร —
      "ริวจิ ถ้าเจอไจ๋ไจ๋ตอนนี้ โดนฟาดแน่ๆ 💀",
      "มนภัทร กรุงเทพพิทยา ตามหลังแบบนี้ก็ยังพลิกได้ เธอล่ะ? 🤔",
      "แข่งกับคอปเตอร์ยังแพ้เลย ตรงนี้ก็ไม่ต่างกัน 😏",
      "โค้ชตี๋: 'ตามหลังแค่นี้เอง... แต่เธอทำได้มั้ยล่ะ?' 🤔",
      "พีซ: 'ตามหลังอยู่นะ รู้ตัวบ้างมั้ย?' 😏",
      "ข้าวหอม: 'สาธิตองครักษ์ไม่เคยแพ้แบบนี้' ...จริงเหรอ? 🤭",
      "อรุษ: 'นำแค่นี้เอง อย่าเพิ่งดีใจ สาธิตจุฬาเคยโดนพลิกมาแล้ว' 😏",
      "คนมีแต่ดวง... รอบหน้าฉันฟาดคืนแน่ 🍀",
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
      // — ตัวละคร —
      "ริวจิ ตามหลังขนาดนี้ กันเนอร์เห็นคงส่ายหัว 💀",
      "ข้าวหอมส่ง sticker หัวเราะ... ไม่ต้องพูดอะไรแล้ว 555",
      "อรุษ: 'นำเยอะแล้ว แต่อย่าลืม กรุงเทพพิทยากับเอี่ยมสุรีย์จ้องอยู่' 👀",
      "มนภัทรเคยนำแบบนี้ แล้วก็โดนพลิก จำได้มั้ย? 😏",
      "คอปเตอร์จากเอี่ยมสุรีย์ยังไม่เคยแพ้ห่างขนาดนี้ 💀",
      "คอปเตอร์เจอแบบนี้คงยอมไปนานแล้ว 💀",
      "โค้ชตี๋: 'ตามหลังขนาดนี้... อย่ามาร้องไห้หาฉันนะ' 😒",
      "เพลงรักร้อง 'ถ้ายอมแพ้ตอนนี้ ไม่มีใครว่าหรอก~' 🎵",
      "ฟ้าเริ่มเก็บของ... 'จบแล้วใช่มั้ย?' 🤭",
      // — ×9 ขู่ —
      "ตามหลังเยอะ? ไม่เป็นไร... ×9 ตาเดียวกลับมาเลย 😈",
      "เคยเห็น ×9 มั้ย? 200 แต้มตาเดียว พลิกได้เลยนะ 💀",
      "ยิ่งนำเยอะ ยิ่งเจ็บตอนโดน ×9 กลับมา 🔥",
      "row 7 ยังว่างอยู่นะ... คิดดีๆ ล่ะ 👀",
      "ฉันเห็น ×3 สมการ สองฝั่ง... ระวังตัวไว้ 😏",
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
      "โค้ชตี๋: 'swap ก็ได้ แต่ตาหน้าต้อง Bingo นะ!' 😤",
      "พีซ: 'เฮ้ย แม้แต่ AI ยัง swap เลย ฮ่าๆ'",
      "เทียน2: 'พี่ AI ก็ rack แย่เป็นเหมือนกันเหรอ!' 😂",
    ],
    AI_PASS: [
      "Pass. Couldn't find anything good. ครั้งแรกในชีวิตเลย 😅",
      "Skipping. Your rack must be even worse.",
      "Pass... saving my brilliance for next turn.",
      "ปล่อยให้เธอเล่นก่อน เป็นมารยาท",
      // — Modern Thai slang —
      "Pass... ตาฉันเซฟพลัง รอตาหน้าฟาด",
      "ขิตอะ เล่นไม่ออก พักก่อน 🤭",
      "โค้ชตี๋ส่ายหัว 'แม้แต่ AI ยัง pass... เกมนี้มันยากจริง' 😅",
      "จิณตา: 'AI pass? นี่มัน rack อะไรกันเนี่ย'",
      "ปุณ: 'เครื่องคิดเลขยัง error ได้ AI ก็ pass ได้' 555",
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
      "พีซ: 'เห็นเบี้ยก็รู้ว่าเล่นได้นะ ทำไม pass?'",
      // — ตัวละคร —
      "น้องพัฟยังหาสมการได้เลยนะ แย่จัง 💀",
      "น้องโอโอยังไม่เคย pass เลยนะ แย่กว่าเด็กอีก 💀",
      "ต้นไม้ว่า pass แบบนี้ ไม่ใช่ฉลาด ตันต่างหาก 🌳",
      "ริวจิ pass แบบนี้ ไจ๋ไจ๋เห็นคงยิ้มเลย 😏",
      "คอปเตอร์ไม่เคย pass นะ... แค่พูดเฉยๆ 💀",
      "pass อีก กันเนอร์คงบอกว่า free win แล้ว 555",
      "ข้าวหอม: 'pass เยอะขนาดนี้ เล่น crossword ดีกว่ามั้ย?' 😅",
      "อรุษ: 'ริวจิ pass อีกแล้ว เสียชื่อสาธิตจุฬา' 🤦",
      "โค้ชตี๋กอดอก 'pass อีกทีเดียว ฉันเลิกสอนเลย' 😤",
      "เทียน2: 'พี่ครับ ผมยังเล่นได้เลยนะ ทำไมพี่ pass?' 🤭",
      "จิณตาถอนหายใจยาว... 'เก่งจริงๆ นะ ที่ pass ได้ลง'",
      "ปุณ: 'pass = ยอมแพ้ ใช่มั้ย? ใช่มั้ย?!' 😏",
      "ปุณโดนฟรีซรึเปล่า ทำไม pass! 🥶",
      "ตี๊ด ต๊อด ตี๊ด ตี๊ด ตอด... pass อีกแล้ว 🎵",
      "ตี๊ด ๆ ๆ ต๊อด ๆ ๆ pass! 🎵",
      "โค้ชตี๋จ้องแล้วนะ... pass อีกที โดนเรียกคุยแน่ 👀",
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
      // — ตัวละคร —
      "น้องรดาว่า swap อีกแล้วเหรอ อ่อนจัง 🤭",
      "น้องพัฟ swap น้อยกว่าเธออีก แต่คะแนนเยอะกว่า 🤭",
      "ตี๊ด ต๊อด ตี๊ด ตี๊ด ตอด... swap อีกแล้วจ้า 🎵",
      "ตี๊ด ๆ ๆ ต๊อด ๆ ๆ swap! 🎵",
      "เบี้ยไม่ดีเลย แกล้งหยิบเกินดีกว่า 🤭",
      "ริวจิ swap อีกแล้ว มนภัทรเห็นคงหัวเราะ 🤭",
      "ไจ๋ไจ๋ไม่เคย swap เลยนะ... กดดันมั้ย? 😏",
      "โค้ชตี๋: 'swap = บอกทั้งโลกว่าอ่าน rack ไม่ออก' 🤦",
      "ฟ้ากระซิบ 'swap อีกแล้ว... กี่ครั้งแล้วนะวันนี้?'",
      "เทียน1: 'swap มากกว่าเล่นอีก สถิติใหม่!' 📊",
      "คนมีแต่ดวง... swap แล้วได้ rack ดีอีก ก็ไม่แปลก 🍀",
      "ข้าวหอมกับกันเนอร์ดูแล้วส่ายหัวพร้อมกัน... สาธิตองครักษ์ไม่ swap เยอะขนาดนี้ 💀",
      "อรุษ: 'swap อีกแล้ว... rack ดีก็ไม่มีประโยชน์ถ้าคิดไม่ออก' 😏",
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
      // — ตัวละคร —
      "น้องรดาเห็นแต้มนี้คงกรี๊ดเลย! 🎉",
      "ต้นไม้ยิ้มมุมปาก... ท่านี้สอนมาดี 🌳",
      "น้องพัฟจดไว้ เทคนิคเก็บแต้มเยอะๆ ✍️",
      "ริวจิ ท่านี้เอาไว้ใช้ตอนเจอมนภัทร ได้ผลแน่ 🎯",
      "กันเนอร์เห็นแต้มนี้คงอึ้งเลย 😲",
      "ข้าวหอม: 'แต้มเยอะจัง... แต่ตาหน้าฉันเยอะกว่า' 😏",
      "อรุษจดสถิติ 'ริวจิโดน 50+ อีกแล้ว... สาธิตจุฬาไม่ไหว' 📊",
      "โค้ชตี๋ยิ้มกว้าง 'นี่แหละที่สอนมา... เก็บเต็ม!' 😎",
      "เทียน2ตบมือ 'โหย! แต้มเยอะมาก!' ...แต่เธอโดนนะ 💀",
      "ปุณเปิดเครื่องคิดเลข... 'คะแนนจริงเหรอ?! ตกใจ!'",
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
      // — ตัวละคร —
      "น้องรดาว่า เร็วๆ หน่อย อยากดูแล้ว! 🙋",
      "น้องพัฟเห็นคงบอก ทำได้แค่นี้เหรอ 🤭",
      "ต้นไม้ส่ายกิ่ง... คิดอะไรอยู่ 🌳",
      "น้องโอโอเบื่อรอแล้ว เล่นเร็วหน่อย",
      "ริวจิ ถ้าแข่งจริงโดน timeout ไปนานแล้ว 🧠",
      "ซ้อมแบบนี้ ไจ๋ไจ๋กับคอปเตอร์เจอก็หัวเราะ 555",
      "โค้ชตี๋จิบกาแฟรอ... 'ไม่รีบนะ ฉันว่างทั้งวัน' ☕",
      "พีซแอบดูเบี้ยเธอ แล้วก็ทำหน้าสงสาร 🥲",
      "ฟ้านั่งวาดรูปเล่นรอ... 'เล่นเสร็จบอกนะ' 🎨",
      "เทียน1เทียน2เล่นเป่ายิ้งฉุบกันระหว่างรอ ✊✋✌️",
      "โค้ชตี๋จ้องแล้วนะ อย่าทำให้ผิดหวัง 👀",
      "ข้าวหอม: 'เล่นระดับนี้ มาสาธิตองครักษ์ไม่ผ่านรอบแรก' 😏",
      "อรุษนั่งดูเงียบๆ... 'คิดให้ดีนะ อย่าเสียชื่อสาธิตจุฬา' 👀",
      "จิณตากดดัน โดนโค้ชตี๋จ้อง 👀",
      "ปุณขยับแว่นแล้วนะ 🤓",
      "มนภัทรซ้อมอยู่ที่กรุงเทพพิทยา รอแข่งกับเธออยู่ 🔥",
      "คอปเตอร์ เอี่ยมสุรีย์ ส่งข้อความมา 'เจอกันรอบหน้า' 👊",
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
      "โค้ชตี๋แอบดูเบี้ยเธอ... เห็นชัดๆ ว่าเล่นได้ตั้งเยอะ",
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
      // — ตัวละคร —
      "น้องรดานั่งรอจนซนไปเล่นอย่างอื่นแล้ว 😂",
      "น้องพัฟบอก ตัวเองยังคิดเร็วกว่านี้อีก 😏",
      "ต้นไม้ส่ายหัว... คิดนานขนาดนี้ ไม่ไหวจริง 🌳",
      "น้องโอโอหาว... คิดเสร็จยังคะ? 😴",
      "ริวจิ ถ้าแข่งจริง คอปเตอร์กดนาฬิกาไปนานแล้ว ⏱️",
      "ไจ๋ไจ๋เล่น 3 ตาแล้ว เธอยังคิดตาเดียวไม่เสร็จ 💀",
      "มนภัทรเห็นเธอคิดนาน คงดีใจมาก easy win 🤭",
      "เด็กกรุงเทพพิทยาคิดเร็วกว่านี้อีก มนภัทรบอกเอง 😏",
      "คอปเตอร์ เอี่ยมสุรีย์ ตัดสินใจภายใน 10 วินาที เธอล่ะ? ⏱️",
      "กันเนอร์บอก... 'คิดนานขนาดนี้ ฉันเล่น 2 เกมจบแล้ว' 555",
      "ข้าวหอมไปชงกาแฟมาแล้ว ยังคิดไม่เสร็จอีกเหรอ ☕",
      "ตี๊ด ต๊อด ตี๊ด ตี๊ด ตอด... คิดนานจัง 🎵",
      "อรุษ: 'สาธิตจุฬาคิดช้าขนาดนี้ มนภัทร กรุงเทพพิทยา หัวเราะแน่' ⚡",
      "คิดนานแบบนี้ จะได้ไปสาธิตสามัคคีไหม? 🤔",
      "hell hammer ขึ้นเป็นเมต้าแล้วนะ รู้ยัง? 🎮",
      "ปล่อยจอย อยู่รึเปล่า? 🕹️",
      "ตี๊ด ๆ ๆ ต๊อด ๆ ๆ 🎵",
      "ฟ้าต่อยท้องโค้ชตี๋ หัวเราะลั่นห้อง 😂",
      "โค้ชตี๋จ้องแล้วนะ... คิดนานไปเดี๋ยวโดนด่า 👀",
      "ปุณโดนฟรีซ! ...เอ๊ะ ไม่ใช่ คนเล่นต่างหากที่แข็ง 🥶",
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
      "ใครว่า ×3 สมการ คุมยาก? โค้ชตี๋โชว์ให้ดู — x9!",
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
  function selectMessage(context, force, isEarlyGame) {
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

    // In early game, filter out ×9 scare lines — not relevant yet
    if (isEarlyGame) {
      var filtered = pool.filter(function(m) {
        return m.indexOf('×9') < 0 && m.indexOf('x9') < 0 && m.indexOf('×3 สมการ') < 0;
      });
      if (filtered.length > 0) pool = filtered;
    }

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
    const isEarly = !!(state && state.isEarlyGame);
    const msg = selectMessage(ctx, force, isEarly);
    if (msg) showToast(msg);
  }

  window.AMath = window.AMath || {};
  window.AMath.trashTalk = {
    fireForEvent: fireForEvent,
    selectMessage: selectMessage,
    showToast: showToast,
  };
})();
