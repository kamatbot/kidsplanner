/* ============================================================
   DAILY CONTENT DATA
============================================================ */

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Learning is not attained by chance; it must be sought for with ardor and diligence.", author: "Abigail Adams" },
  { text: "Education is the most powerful weapon you can use to change the world.", author: "Nelson Mandela" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
  { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Every accomplishment starts with the decision to try.", author: "Gail Devers" },
  { text: "Shoot for the moon. Even if you miss, you'll land among the stars.", author: "Les Brown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Wake up with determination. Go to bed with satisfaction.", author: "Unknown" },
  { text: "Work hard in silence, let success make the noise.", author: "Frank Ocean" },
  { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" },
  { text: "Dream it. Wish it. Do it.", author: "Unknown" },
  { text: "In learning you will teach, and in teaching you will learn.", author: "Phil Collins" },
  { text: "The key to success is to focus on goals, not obstacles.", author: "Unknown" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown" },
  { text: "Little by little, one travels far.", author: "J.R.R. Tolkien" },
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", author: "Plutarch" },
  { text: "Curiosity is the wick in the candle of learning.", author: "William Arthur Ward" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
];

const SAT_WORDS = [
  { word: "Eloquent",    pos: "adjective", def: "Fluent or persuasive in speaking or writing.",                                    example: "The eloquent speaker captivated the audience with her powerful words." },
  { word: "Persevere",   pos: "verb",      def: "Continue in a course of action despite difficulty or with little indication of success.", example: "She decided to persevere with her studies despite the many challenges." },
  { word: "Diligent",    pos: "adjective", def: "Showing care and conscientiousness in one's work or duties.",                     example: "The diligent student always completed his homework before watching TV." },
  { word: "Benevolent",  pos: "adjective", def: "Well-meaning and kindly; generous or charitable.",                                example: "The benevolent teacher stayed after class to help struggling students." },
  { word: "Tenacious",   pos: "adjective", def: "Tending to keep a firm hold; persistent.",                                        example: "The tenacious athlete practiced every day for three years to reach the Olympics." },
  { word: "Ambiguous",   pos: "adjective", def: "Open to more than one interpretation; unclear.",                                  example: "The teacher's ambiguous instructions confused many students in the class." },
  { word: "Candid",      pos: "adjective", def: "Truthful and straightforward; frank.",                                            example: "She gave a candid answer about why she didn't finish her homework." },
  { word: "Meticulous",  pos: "adjective", def: "Showing great attention to detail; very careful and precise.",                    example: "The meticulous scientist checked each experiment three times before recording results." },
  { word: "Resilient",   pos: "adjective", def: "Able to withstand or recover quickly from difficult conditions.",                 example: "Despite failing twice, the resilient student tried again and passed the exam." },
  { word: "Collaborate", pos: "verb",      def: "Work jointly on an activity, especially to produce or create something.",         example: "The students decided to collaborate on the science project to combine their strengths." },
  { word: "Empathy",     pos: "noun",      def: "The ability to understand and share the feelings of another.",                    example: "She showed great empathy when her friend was upset about not making the team." },
  { word: "Innovative",  pos: "adjective", def: "Featuring new methods; advanced and original.",                                   example: "The innovative inventor created a device that solved a common household problem." },
  { word: "Intrepid",    pos: "adjective", def: "Fearless; adventurous.",                                                          example: "The intrepid explorer ventured deep into the jungle without hesitation." },
  { word: "Verbose",     pos: "adjective", def: "Using more words than are needed.",                                               example: "His verbose essay needed editing because the main point got lost in extra words." },
  { word: "Pragmatic",   pos: "adjective", def: "Dealing with things sensibly and realistically based on practical considerations.", example: "The pragmatic student chose an essay topic she already knew well to save time." },
  { word: "Prolific",    pos: "adjective", def: "Present in large numbers or quantities; highly productive.",                      example: "The prolific author wrote over 50 books during his lifetime." },
  { word: "Resolute",    pos: "adjective", def: "Admirably purposeful, determined, and unwavering.",                               example: "She was resolute in her decision to become a doctor, despite the long years of study." },
  { word: "Skeptical",   pos: "adjective", def: "Not easily convinced; having doubts or reservations.",                            example: "He was skeptical about the magic trick until he saw it performed three times." },
  { word: "Steadfast",   pos: "adjective", def: "Resolutely firm and unwavering.",                                                 example: "She remained steadfast in her belief that hard work would lead to success." },
  { word: "Ubiquitous",  pos: "adjective", def: "Present, appearing, or found everywhere.",                                        example: "Smartphones have become ubiquitous in modern society." },
  { word: "Vivacious",   pos: "adjective", def: "Attractively lively and animated.",                                               example: "The vivacious student lit up every classroom discussion with her enthusiasm." },
  { word: "Zealous",     pos: "adjective", def: "Having or showing great energy or enthusiasm in pursuit of a goal.",              example: "The zealous volunteer spent every weekend helping at the animal shelter." },
  { word: "Adept",       pos: "adjective", def: "Very skilled or proficient at something.",                                        example: "After years of practice, she became adept at playing the violin." },
  { word: "Astute",      pos: "adjective", def: "Having an ability to accurately assess situations and turn this to one's advantage.", example: "The astute student noticed the pattern in the math problem before others did." },
  { word: "Coherent",    pos: "adjective", def: "Logical and consistent; forming a unified whole.",                                example: "A coherent essay has a clear introduction, body, and conclusion." },
  { word: "Enigmatic",   pos: "adjective", def: "Difficult to interpret or understand; mysterious.",                               example: "The Mona Lisa's smile is considered enigmatic — no one can tell exactly what emotion it shows." },
  { word: "Transient",   pos: "adjective", def: "Lasting only for a short time; impermanent.",                                     example: "The snow was transient, melting by noon on the first day of spring." },
  { word: "Placid",      pos: "adjective", def: "Not easily upset or excited; calm and peaceful.",                                 example: "The placid lake reflected the mountains perfectly on the windless morning." },
  { word: "Credible",    pos: "adjective", def: "Able to be believed; convincing.",                                                example: "Use credible sources like encyclopedias and textbooks for your research paper." },
  { word: "Wary",        pos: "adjective", def: "Feeling or showing caution about possible dangers or problems.",                  example: "Be wary of anyone who promises easy success without hard work." },
];

const NEWS_ITEMS = [
  { cat: "🚀 Space",       headline: "Webb Telescope Discovers Ancient Galaxies",          summary: "Scientists using the James Webb Space Telescope have identified thousands of previously unknown galaxies, revealing what the universe looked like just 500 million years after the Big Bang." },
  { cat: "🐾 Animals",     headline: "Rare White Giraffe Spotted in Kenya",                summary: "Conservationists spotted a leucistic giraffe in Kenya's national park. These animals lack pigmentation and appear white, making them extraordinarily rare in the wild." },
  { cat: "💡 Tech",        headline: "Students Design Robot to Clean Ocean Plastic",       summary: "A team of high school students won a global engineering competition with their autonomous robot that collects plastic waste from ocean surfaces without harming marine life." },
  { cat: "🔬 Science",     headline: "New Solar Panel Generates Power From Windows",       summary: "Scientists have developed ultra-thin solar panels that can be attached to windows, turning ordinary buildings into electricity generators — without blocking the view." },
  { cat: "🌿 Environment", headline: "Teen Invents Device to Purify River Water",          summary: "A 15-year-old from India invented an affordable water purification device using local materials that can clean contaminated river water for drinking in just minutes." },
  { cat: "🐸 Animals",     headline: "Colorful New Frog Species Found in Amazon",         summary: "Biologists exploring the Amazon rainforest discovered a new species of dart frog with brilliant blue and yellow patterns that could help scientists develop new medicines." },
  { cat: "🚀 Space",       headline: "Spacecraft Successfully Lands on the Moon",          summary: "A new spacecraft successfully landed on the Moon, carrying scientific instruments designed to study the lunar surface and test technology for future human landings." },
  { cat: "💡 Tech",        headline: "AI Decodes 4,000-Year-Old Ancient Language",        summary: "Artificial intelligence successfully translated a mysterious ancient language that had puzzled historians for decades, unlocking secrets from Mesopotamian civilization." },
  { cat: "🌿 Environment", headline: "Giant Forest in Costa Rica Fully Restored",          summary: "A massive reforestation effort in Costa Rica successfully restored over 3 million acres of tropical forest, bringing back wildlife and cleaner air to the region." },
  { cat: "🔬 Science",     headline: "Scientists Grow Human Ear in Lab for Transplant",   summary: "Medical researchers grew a human ear from a patient's own cartilage cells in a laboratory and successfully transplanted it to a child born without one." },
  { cat: "🐋 Animals",     headline: "Humpback Whale Populations Show 30% Recovery",      summary: "A new census shows humpback whale populations have grown by 30% in the past decade, thanks to international hunting bans and ocean conservation efforts." },
  { cat: "💡 Tech",        headline: "Solar-Powered Plane Completes World Trip",           summary: "An electric airplane powered entirely by solar energy completed a journey around the world, proving that long-distance solar flight is possible — inspiring the future of aviation." },
  { cat: "🔬 Science",     headline: "Researchers Discover Why We Dream at Night",         summary: "New brain research suggests dreams help the brain sort and store important memories while clearing out unnecessary information — like a nightly computer cleanup." },
  { cat: "🌿 Environment", headline: "Youth Group Plants 10 Million Trees in 20 Countries", summary: "A youth-led environmental organization reached its goal of planting 10 million trees across 20 countries, making it one of the largest student-led conservation efforts ever." },
  { cat: "💡 Tech",        headline: "New Battery Could Charge Phone in 5 Minutes",        summary: "Engineers have developed a new graphene-based battery that can charge a smartphone to 100% in under five minutes — and last for 20 years without degrading." },
  { cat: "🐆 Animals",     headline: "Cheetah Cubs Born in India After 70 Years",          summary: "For the first time in 70 years, cheetah cubs were born in the wild in India after a successful reintroduction program brought cheetahs from Namibia and South Africa." },
  { cat: "🔬 Science",     headline: "Gene Therapy Successfully Treats Rare Disease",      summary: "Scientists announced a new gene therapy that successfully treated a rare genetic disorder in children, offering hope to millions of families worldwide." },
  { cat: "🚀 Space",       headline: "Earth-Sized Planet Found in Habitable Zone",         summary: "NASA announced the discovery of an Earth-sized planet where conditions might be right for liquid water — and potentially life — around a nearby star." },
  { cat: "🌿 Environment", headline: "Coral Reef Shows Unexpected Signs of Recovery",      summary: "Parts of the Great Barrier Reef are recovering faster than expected after efforts to reduce pollution and control invasive starfish that had been damaging the coral." },
  { cat: "🔬 Science",     headline: "Scientists Create Material Stronger Than Diamonds",  summary: "Researchers have engineered a new carbon-based material that outperforms diamonds in hardness tests, with potential uses in aerospace, medicine, and electronics." },
];

const QUIZ = [
  { q: "What is the largest planet in our Solar System?",           opts: ["Saturn","Jupiter","Neptune","Uranus"],          ans: 1, exp: "Jupiter is the largest — all other planets could fit inside it!" },
  { q: "How many continents are there on Earth?",                   opts: ["5","6","7","8"],                                ans: 2, exp: "7 continents: Africa, Antarctica, Asia, Australia, Europe, North America, South America." },
  { q: "What gas do plants use during photosynthesis?",             opts: ["Oxygen","Nitrogen","Carbon Dioxide","Hydrogen"], ans: 2, exp: "Plants absorb CO₂ and release oxygen — the opposite of what animals do!" },
  { q: "Which is the chemical symbol for water?",                   opts: ["WO","H₂O","HO₂","W₂O"],                        ans: 1, exp: "H₂O means two hydrogen atoms bonded to one oxygen atom." },
  { q: "Who invented the telephone?",                               opts: ["Thomas Edison","Nikola Tesla","Alexander Graham Bell","Benjamin Franklin"], ans: 2, exp: "Alexander Graham Bell patented the first practical telephone in 1876." },
  { q: "What is the fastest land animal?",                          opts: ["Lion","Gazelle","Horse","Cheetah"],             ans: 3, exp: "The cheetah can reach speeds up to 70 mph (112 km/h)." },
  { q: "How many bones does an adult human body have?",             opts: ["196","206","216","226"],                        ans: 1, exp: "Adults have 206 bones. Babies are born with ~270, but many fuse as we grow." },
  { q: "What is the capital city of France?",                       opts: ["Lyon","Marseille","Nice","Paris"],              ans: 3, exp: "Paris is the capital and largest city of France." },
  { q: "Which planet is called the Red Planet?",                    opts: ["Venus","Mars","Mercury","Jupiter"],             ans: 1, exp: "Mars gets its red color from iron oxide (rust) on its surface." },
  { q: "What is the hardest natural substance on Earth?",           opts: ["Quartz","Gold","Diamond","Iron"],               ans: 2, exp: "Diamond rates 10 on the Mohs hardness scale — the highest possible." },
  { q: "Who wrote 'Romeo and Juliet'?",                             opts: ["Charles Dickens","William Shakespeare","Jane Austen","Homer"], ans: 1, exp: "Shakespeare wrote Romeo and Juliet around 1594–1596." },
  { q: "What is the largest ocean on Earth?",                       opts: ["Atlantic","Indian","Arctic","Pacific"],         ans: 3, exp: "The Pacific Ocean covers ~30% of Earth's surface — larger than all land combined!" },
  { q: "How many sides does a hexagon have?",                       opts: ["5","6","7","8"],                                ans: 1, exp: "Hex = six. Think of a honeycomb — each cell is a hexagon!" },
  { q: "What organ pumps blood through your body?",                 opts: ["Liver","Lung","Brain","Heart"],                 ans: 3, exp: "Your heart beats about 100,000 times every day!" },
  { q: "What is the longest river in the world?",                   opts: ["Amazon","Mississippi","Nile","Yangtze"],        ans: 2, exp: "The Nile River in Africa stretches about 6,650 km." },
  { q: "In what year did World War II end?",                        opts: ["1943","1944","1945","1946"],                    ans: 2, exp: "WWII ended in 1945: Germany surrendered in May and Japan in September." },
  { q: "What is the smallest planet in our Solar System?",          opts: ["Mercury","Mars","Venus","Pluto"],               ans: 0, exp: "Mercury is smallest (Pluto is a dwarf planet now). Mercury is barely larger than Earth's Moon." },
  { q: "What language is spoken in Brazil?",                        opts: ["Spanish","Portuguese","French","Brazilian"],    ans: 1, exp: "Brazil was colonized by Portugal, so Portuguese is the official language." },
  { q: "How many strings does a standard guitar have?",             opts: ["4","5","6","7"],                                ans: 2, exp: "A standard acoustic or electric guitar has 6 strings." },
  { q: "What is the square root of 144?",                           opts: ["11","12","13","14"],                            ans: 1, exp: "12 × 12 = 144, so √144 = 12." },
  { q: "Which animal is the largest mammal on Earth?",              opts: ["African Elephant","Blue Whale","Giraffe","Hippopotamus"], ans: 1, exp: "The blue whale is the largest animal ever known, reaching up to 30 meters long!" },
  { q: "What does HTML stand for?",                                 opts: ["HyperText Makeup Language","HyperText Markup Language","HighText Markup Language","HyperText Machine Language"], ans: 1, exp: "HTML (HyperText Markup Language) is the standard language for building web pages." },
  { q: "Where were the ancient Olympic Games held?",                opts: ["Athens","Rome","Sparta","Olympia"],             ans: 3, exp: "The ancient Olympics began in Olympia, Greece, in 776 BC." },
  { q: "What is the most widely studied language globally?",        opts: ["English","Spanish","Mandarin Chinese","Hindi"], ans: 0, exp: "English is the most widely learned and used language worldwide, with ~1.5 billion speakers." },
  { q: "What does DNA stand for?",                                  opts: ["Digital Nucleic Acid","Deoxyribonucleic Acid","Double Natural Atoms","Dynamic Nucleic Assembly"], ans: 1, exp: "DNA = Deoxyribonucleic Acid, the molecule that carries genetic information." },
  { q: "How many colors are in a rainbow?",                         opts: ["5","6","7","8"],                                ans: 2, exp: "7 colors: Red, Orange, Yellow, Green, Blue, Indigo, Violet (ROY G BIV)." },
  { q: "Who was the first person to walk on the Moon?",             opts: ["Buzz Aldrin","Neil Armstrong","Yuri Gagarin","John Glenn"], ans: 1, exp: "Neil Armstrong walked on the Moon on July 20, 1969, during Apollo 11." },
  { q: "What is the approximate speed of light?",                   opts: ["150,000 km/s","200,000 km/s","300,000 km/s","400,000 km/s"], ans: 2, exp: "Light travels at ~300,000 km/s (186,000 miles/s) in a vacuum." },
  { q: "Which continent has the most countries?",                   opts: ["Asia","Europe","South America","Africa"],       ans: 3, exp: "Africa has 54 recognized countries — more than any other continent." },
  { q: "How many players are on a basketball team on the court?",   opts: ["4","5","6","7"],                                ans: 1, exp: "Each basketball team has 5 players on the court at a time." },
];

/* ============================================================
   LEGACY STORAGE MIGRATION (kp_ -> fam_) — one-time, idempotent.
   This is the ONLY place kp_ keys are read or written anywhere
   in this file. Every other function below uses fam_ only.
============================================================ */
function migrateLegacyStorage() {
  const KP_KEYS = ['kp_users', 'kp_events', 'kp_schedules', 'kp_session'];
  try {
    KP_KEYS.forEach((kpKey) => {
      const famKey = kpKey.replace(/^kp_/, 'fam_');
      if (localStorage.getItem(famKey) !== null) return; // already migrated
      const legacy = localStorage.getItem(kpKey);
      if (legacy !== null) localStorage.setItem(famKey, legacy);
    });
    // Prefixed per-user keys: kp_qoffset_<id>, kp_streak_<id>
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (/^kp_(qoffset|streak)_/.test(key)) {
        const famKey = key.replace(/^kp_/, 'fam_');
        if (localStorage.getItem(famKey) === null) {
          localStorage.setItem(famKey, localStorage.getItem(key));
        }
      }
    }
  } catch (e) { /* localStorage unavailable — nothing to migrate */ }
}

/* ============================================================
   STATE
============================================================ */
let sessionUser     = null;   // { id, email, name, createdAt } from GET /api/me
let currentFamily    = null;  // { id, name, inviteCode, parentIds, kids, createdAt }
let activeKidId      = null;  // currently selected kid filter ("" = all kids)
let currentView     = 'week';
let weekStart       = null;   // Monday of displayed week
let monthDate       = null;   // any date in displayed month
let miniMonth       = null;   // any date in mini-cal month
let quizIndex       = 0;
let activeEventId   = null;
let activeEventRecurring = false; // set by showDetail; drives the delete confirm() copy
let activeEventObj  = null;   // the resolved event object from showDetail; source for editCurrentEvent()
let editingEventId  = null;   // set by editCurrentEvent(); when non-null saveEvent() PATCHes instead of POSTs
let pendingDate     = null;   // pre-filled date for add-event modal
let uploadedFile    = null;

/* Chat */
let chatMessages    = [];     // messages currently rendered, oldest-first
let chatLastAt      = null;   // createdAt cursor (used for the one-shot ?since= fetch)
let chatLastId      = null;   // id cursor for the long-poll ?afterId=
let chatPollTimer   = false;  // truthy while the long-poll loop should keep running
let chatPollAbort   = null;   // AbortController for the in-flight long-poll fetch, if any
const CHAT_LONGPOLL_WAIT_S = 25; // must match LONG_POLL_MS in lib/routes/chat.js
const CHAT_BACKOFF_MS = [2000, 5000, 10000]; // retry backoff on poll errors, capped

/* Chat: emoji + GIF pickers (see CHAT PICKERS section near the bottom) */
const CHAT_EMOJI_LIST = [
  '😀','😁','😂','🤣','😊','😍','😘','😜','🤪','😎',
  '🥳','🤩','😇','🙂','😉','😢','😭','😱','😡','🤔',
  '🙄','😴','🤗','🤭','😬','🥺','😅','😆','😋','🤤',
  '👍','👎','👏','🙌','🙏','💪','🤝','👋','✌️','🤞',
  '❤️','🧡','💛','💚','💙','💜','🖤','💕','💯','🔥',
  '⭐','✨','🎉','🎈','🎂','🏆','⚽','🎮','📚','🐶',
  '🐱','🦄','🌈','☀️','🍕','🍔','🍦','🚗','🏠','⏰',
];
let chatGifSearchTimer = null;
let chatGifOpenToken   = 0; // bumped on every open/search so stale async loads no-op

/* School calendar (Phase 2) — server-sourced, read-only events merged
   alongside localStorage manual events for display. Never written to
   localStorage; always re-fetched from /api/calendar/sync. */
let schoolFeedsInfo  = null;  // { builtin, subscriptions, lastSyncAt } from GET /api/calendar/feeds
let schoolEvents     = [];    // windowed, deduped, tagged events from last sync
let schoolSyncErrors = [];    // [{ subscriptionId, label, error }] from the last sync
const SCHOOL_AUTO_SYNC_MIN_MS = 60 * 60 * 1000; // mirrors server-side throttle

/* Kid -> Moodle numeric user id mappings (Settings "School (Moodle) IDs"
   card). Cached from GET /api/school/status (kidMappings) so the Chrome
   extension's background worker can read them via window.famGetSchoolMappings()
   without re-hitting the server on every check. Kept in sync whenever a
   parent saves a mapping — see handleSaveMoodleId(). */
let schoolKidMappings = []; // [{ kidId, moodleUserId }] as returned by the server

/* ============================================================
   THEME (dark mode) — fam_theme in localStorage: 'light' | 'dark' | 'system'.
   Applied before first paint by the inline <head> script in index.html;
   this just keeps it in sync after a user picks a theme in Settings.
============================================================ */
function setTheme(choice) {
  if (choice === 'system') {
    localStorage.removeItem('fam_theme');
  } else {
    save('fam_theme', choice);
  }
  applyThemeChoice();
}

function applyThemeChoice() {
  const choice = load('fam_theme') || 'system';
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelectorAll('#theme-toggle [data-theme-choice]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === choice);
  });
}

function initTheme() {
  applyThemeChoice();
  // Auto mode should follow a live OS theme change, not just the page load.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!load('fam_theme')) applyThemeChoice();
    });
  }
}

/* ============================================================
   SIDEBAR USER MENU (click-toggle dropdown — the old header version was
   hover-only, which doesn't work on touch/iPad)
============================================================ */
function toggleUserMenu() {
  const menu = document.getElementById('sidebar-user-menu');
  if (menu) menu.classList.toggle('open');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('sidebar-user-menu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target)) menu.classList.remove('open');
});

/* ============================================================
   ENRICHMENT + NOTES (Notes tab, quote/mood/news reflections,
   SAT word activity + word bank + pop quiz, brain teaser, gating).
   See /private/tmp .../enrichment-spec.md section 4 for the contract.
============================================================ */
let notesItems      = [];    // last-loaded list from GET /api/notes
let currentQuote    = null;  // today's { text, author }
let currentNews     = null;  // today's { cat, headline, summary }
let currentSatWord  = null;  // today's { word, pos, def, example }
let wordBankState   = { words: [], stats: { learning: 0, mastered: 0, known: 0 } };
let wordQuizState   = { questions: [], index: 0 };
let satPlacementDone = false; // tracked via localStorage per-user, see satPlacementKey()

/* ---------- gating: homework due today > 3 disables enrichment cards ---------- */
function homeworkDueTodayCount() {
  const today = isoDate(new Date());
  return homeworkItems.filter((h) => h.dueDate === today && h.status !== 'done').length;
}

function applyEnrichmentGating() {
  const dueCount = homeworkDueTodayCount();
  const locked = dueCount > 3;
  const lockIds = ['lock-quote', 'lock-sat', 'lock-news', 'lock-quiz'];
  const cardIds = ['widget-quote', 'widget-word', 'widget-news', 'widget-quiz'];
  lockIds.forEach((id, i) => {
    const overlay = document.getElementById(id);
    const card = document.getElementById(cardIds[i]);
    if (!overlay || !card) return;
    if (locked) {
      overlay.hidden = false;
      overlay.textContent = `Finish your homework first 📚 — ${dueCount} due today`;
      card.classList.add('fam-locked');
    } else {
      overlay.hidden = true;
      card.classList.remove('fam-locked');
    }
  });
}

/* ---------- Quote widget: flip + reflection ---------- */
function flipQuoteCard(showBack) {
  const inner = document.getElementById('quote-flip-inner');
  if (!inner) return;
  inner.classList.toggle('flipped', !!showBack);
}

async function saveQuoteReflection() {
  const textEl = document.getElementById('quote-reflect-text');
  const body = textEl ? textEl.value.trim() : '';
  if (!body) { toast('Write a few words first 🙂'); return; }
  const note = await saveNoteFromWidget(body, 'quote', { kind: 'quote', id: '', context: currentQuote ? currentQuote.text : '' });
  if (note) {
    textEl.value = '';
    flipQuoteCard(false);
  }
}

async function handlePinQuote() {
  if (!currentQuote) return;
  const full = `"${currentQuote.text}" — ${currentQuote.author}`;
  await saveNoteFromWidget(full, 'quote', { kind: 'quote', id: '', context: full });
}

/* ---------- News widget: reflection ---------- */
// The article link: an explicit url if the item has one, else a Google News
// search for the headline, which reliably surfaces real coverage of the story.
function newsArticleLink(n) {
  if (!n) return '';
  if (n.url) return n.url;
  return 'https://news.google.com/search?q=' + encodeURIComponent(n.headline);
}

async function saveNewsReflection() {
  const textEl = document.getElementById('news-reflect-text');
  const body = textEl ? textEl.value.trim() : '';
  if (!body) { toast('Write a few words first 🙂'); return; }
  const link = newsArticleLink(currentNews);
  const newsFull = currentNews ? `${currentNews.headline}\n\n${currentNews.summary}\n\n${link}` : '';
  const note = await saveNoteFromWidget(body, 'news', { kind: 'news', id: '', context: newsFull });
  if (note) textEl.value = '';
}

/* ---------- chat: pin a message to notes ---------- */
async function handlePinChatMessage(id) {
  const msg = chatMessages.find((m) => m.id === id);
  if (!msg || !msg.text) return;
  await saveNoteFromWidget(msg.text, 'chat', { kind: 'chat', id: msg.id, context: msg.text });
}

/* ============================================================
   SESSION / FAMILY BOOTSTRAP (backend-sourced)
============================================================ */
async function bootstrapSession() {
  const me = await window.auth.getMe();
  if (!me || !me.user) {
    window.location.href = '/login';
    return false;
  }
  sessionUser = me.user;
  save('fam_user', sessionUser);
  applyRoleScopingToUI();

  try {
    const families = await window.auth.getFamilies();
    currentFamily = families[0] || null;
  } catch (e) {
    currentFamily = null;
  }
  save('fam_family', currentFamily);

  if (!currentFamily) {
    // A kid session should never reach first-run (their family already
    // exists — a parent created it) — but guard anyway rather than show a
    // parent-only create/join panel to a kid.
    if (isKidSession()) {
      toast('❌ No family found for this account. Ask a parent to check your device setup.');
    } else {
      showFirstRunPanel();
    }
  } else {
    hideFirstRunPanel();
    renderKidSwitcher();
  }
  return true;
}

/* ============================================================
   ROLE SCOPING (kid sessions vs parent sessions)
   Kids are role-scoped to their own calendar/homework/goals + family chat —
   NOT billing, family management, or removing members. See APP-BRIEF.md
   "Kid sign-in". The backend enforces this independently (requireParent on
   every parent-only route) — this is UI-layer only, so a kid never even
   sees a control they can't use.
============================================================ */
function isKidSession() {
  return !!(sessionUser && sessionUser.role === 'kid');
}

function applyRoleScopingToUI() {
  const kid = isKidSession();

  const billingLink = document.getElementById('nav-billing-link');
  if (billingLink) billingLink.style.display = kid ? 'none' : '';

  const settingsParentOnly = document.getElementById('settings-parent-only');
  const settingsNotice = document.getElementById('kid-settings-notice');
  if (settingsParentOnly) settingsParentOnly.style.display = kid ? 'none' : '';
  if (settingsNotice) settingsNotice.style.display = kid ? '' : 'none';

  const schoolParentOnly = document.getElementById('settings-parent-only-school');
  const schoolNotice = document.getElementById('kid-school-notice');
  if (schoolParentOnly) schoolParentOnly.style.display = kid ? 'none' : '';
  if (schoolNotice) schoolNotice.style.display = kid ? '' : 'none';

  const moodleIdsParentOnly = document.getElementById('settings-parent-only-moodle-ids');
  const moodleIdsNotice = document.getElementById('kid-moodle-ids-notice');
  if (moodleIdsParentOnly) moodleIdsParentOnly.style.display = kid ? 'none' : '';
  if (moodleIdsNotice) moodleIdsNotice.style.display = kid ? '' : 'none';

  // Adding school calendars is a parent action — hide the sidebar shortcut for kids.
  const addSchoolCal = document.getElementById('sidebar-add-school-cal');
  if (addSchoolCal) addSchoolCal.style.display = kid ? 'none' : '';

  // "Import from school" (Moodle) is a parent-only action — the button is
  // hidden by default in the HTML and only shown here for parent sessions.
  const schoolImportBtn = document.getElementById('school-import-btn');
  if (schoolImportBtn) schoolImportBtn.style.display = kid ? 'none' : '';
}

function showFirstRunPanel() {
  // .modal-overlay is display:none by default and shown via the .open class
  // (see openModal/closeModal) — toggling style.display alone never shows it.
  const panel = document.getElementById('first-run-panel');
  if (panel) panel.classList.add('open');
}
function hideFirstRunPanel() {
  const panel = document.getElementById('first-run-panel');
  if (panel) panel.classList.remove('open');
}

async function handleCreateFamily(e) {
  e.preventDefault();
  const nameInput = document.getElementById('first-run-family-name');
  const name = nameInput ? nameInput.value.trim() : '';
  const errEl = document.getElementById('first-run-error');
  try {
    const res = await window.auth.createFamily(name);
    currentFamily = res.family;
    save('fam_family', currentFamily);
    hideFirstRunPanel();
    renderKidSwitcher();
    toast('Family created! 🎉');
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

async function handleJoinFamily(e) {
  e.preventDefault();
  const codeInput = document.getElementById('first-run-join-code');
  const code = codeInput ? codeInput.value.trim() : '';
  const errEl = document.getElementById('first-run-error');
  try {
    const res = await window.auth.joinFamily(code);
    currentFamily = res.family;
    save('fam_family', currentFamily);
    hideFirstRunPanel();
    renderKidSwitcher();
    toast('Joined family! 🎉');
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

/* Kid profile form (Settings/Manage Family panel) — name + grade + color only */
async function handleAddKid(e) {
  e.preventDefault();
  if (!currentFamily) return;
  const name  = document.getElementById('kid-name').value.trim();
  const grade = document.getElementById('kid-grade').value;
  const colorInput = document.querySelector('input[name="kid-color"]:checked');
  const color = colorInput ? colorInput.value : undefined;
  const errEl = document.getElementById('kid-form-error');
  try {
    const res = await window.auth.addKid(name, grade, color);
    currentFamily = res.family;
    save('fam_family', currentFamily);
    document.getElementById('kid-name').value = '';
    document.getElementById('kid-grade').value = '';
    renderKidSwitcher();
    renderManageFamily();
    toast(`${name || 'Kid'} added to the family! 👋`);
    if (errEl) errEl.textContent = '';
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

async function handleRemoveKid(kidId) {
  if (!currentFamily) return;
  try {
    const res = await window.auth.removeKid(kidId);
    currentFamily = res.family;
    save('fam_family', currentFamily);
    renderKidSwitcher();
    renderManageFamily();
    toast('Kid profile removed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

// Renders into every .kid-switcher on the page — Calendar and Homework each
// have their own header instance (canvas 1b/1c), sharing the one activeKidId
// state, so both stay in sync no matter which one triggered the change.
function renderKidSwitcher() {
  const els = document.querySelectorAll('.kid-switcher');
  if (!els.length || !currentFamily) return;
  const kids = currentFamily.kids || [];

  // A kid session is locked to its own profile — no "All kids" view and no
  // switching to a sibling. Render a single, non-interactive chip instead.
  if (isKidSession()) {
    const mine = kids.find((k) => k.id === sessionUser.kidId);
    activeKidId = sessionUser.kidId || null;
    const html = mine
      ? `<span class="kid-chip active" style="--kid-color:${kidColorFor(mine.id) || mine.color}">${esc(mine.name)}</span>`
      : '';
    els.forEach((el) => { el.innerHTML = html; });
    return;
  }

  const chips = [`<button class="kid-chip${activeKidId === null ? ' active' : ''}" onclick="setActiveKid(null)">All kids</button>`]
    .concat(kids.map((k) =>
      `<button class="kid-chip${activeKidId === k.id ? ' active' : ''}" style="--kid-color:${kidColorFor(k.id) || k.color}" onclick="setActiveKid('${k.id}')"><span class="kid-chip-dot"></span>${esc(k.name)}</button>`
    ));
  els.forEach((el) => { el.innerHTML = chips.join(''); });
}

function setActiveKid(kidId) {
  activeKidId = kidId;
  renderKidSwitcher();
  renderCalendar();
  renderMiniCal();
  renderSchoolStatsWidget();
  // Homework has its own kid-switcher instance now (canvas 1c) sharing this
  // same state — re-render it too so switching kid from either screen stays
  // in sync without needing a tab switch.
  if (document.getElementById('homework-list')) renderHomeworkHub();
}

function renderManageFamily() {
  applyRoleScopingToUI();
  renderChatDockAvatars();
  // Kid sessions never render family-management controls at all — the
  // parent-only container is hidden by applyRoleScopingToUI(), and the
  // backend independently rejects any parent-only call a kid might still
  // trigger (e.g. via devtools), so this is defense in depth, not the gate.
  if (isKidSession()) return;
  renderMoodleIdsSettings(); // kid list may have changed (add/remove)

  const parentsEl0 = document.getElementById('manage-family-parents');
  const inviteEl0  = document.getElementById('co-parent-invite');
  const kidsEl0    = document.getElementById('manage-family-kids');
  if (!currentFamily) {
    // No family loaded yet — guide the user instead of showing blank sections.
    const msg = `<p class="text-muted">You're not in a family yet.
      <a href="#" onclick="showFirstRunPanel();return false" style="color:var(--accent);font-weight:700">Create or join a family</a> to add parents and kids.</p>`;
    if (parentsEl0) parentsEl0.innerHTML = msg;
    if (inviteEl0)  inviteEl0.innerHTML = '';
    if (kidsEl0)    kidsEl0.innerHTML = '';
    return;
  }

  // --- Parents ---
  const parentsEl = document.getElementById('manage-family-parents');
  if (parentsEl) {
    const parents = currentFamily.parents || (currentFamily.parentIds || []).map((id) => ({ id, name: null }));
    parentsEl.innerHTML = parents.map((p) => {
      const isYou = p.id === (sessionUser && sessionUser.id);
      const label = esc(p.name || 'Parent') + (isYou ? ' <span class="text-muted">(you)</span>' : '');
      const remove = isYou ? '' :
        `<button class="kid-row-remove" onclick="handleRemoveParent('${p.id}')" title="Remove co-parent">×</button>`;
      return `<div class="kid-row">
        <span class="kid-row-swatch" style="background:#6C63FF"></span>
        <span class="kid-row-name">${label}</span>
        <span class="kid-row-grade">Parent</span>
        ${remove}
      </div>`;
    }).join('');
  }

  // --- Co-parent invite (only while there's an open slot) ---
  const inviteEl = document.getElementById('co-parent-invite');
  if (inviteEl) {
    const max = currentFamily.maxParents || 2;
    const count = (currentFamily.parentIds || []).length;
    const code = esc(currentFamily.inviteCode || '');
    // Same code invites the co-parent AND kids, so always show it — just
    // reframe once both parent slots are full.
    const heading = count >= max ? 'Family code' : 'Invite the other parent';
    const blurb = count >= max
      ? `Share this code with your kids. They sign up at <strong>fametc.com</strong>
         (or in the app), enter the code, and you approve them from Today.`
      : `Ask them to sign up at <strong>fametc.com</strong> and enter this family code.
         They'll get their own passkey on their own device.`;
    inviteEl.innerHTML =
      `<div class="invite-box">
        <p style="margin:0 0 6px;font-weight:700">${heading}</p>
        <p class="text-muted" style="margin:0 0 12px">${blurb}</p>
        <div class="invite-code-row">
          <code id="invite-code-value" class="invite-code">${code}</code>
          <button type="button" class="btn-secondary" onclick="copyInviteCode()">Copy code</button>
        </div>
      </div>`;
  }

  // --- Kids ---
  const el = document.getElementById('manage-family-kids');
  if (el) {
    const kids = currentFamily.kids || [];
    el.innerHTML = kids.map((k) =>
      `<div class="kid-row">
        <span class="kid-row-swatch" style="background:${kidColorFor(k.id) || k.color}"></span>
        <span class="kid-row-name">${esc(k.name)}</span>
        <span class="kid-row-grade">${esc(k.grade || '')}</span>
        <button class="kid-row-remove" onclick="handleRemoveKid('${k.id}')" title="Remove kid">×</button>
      </div>`
    ).join('') || '<p class="text-muted">No kids added yet.</p>';
  }
}

/* Kids now sign in from the login screen themselves: they enter the family
   invite code + name, a parent approves the request (Today banner / push), then
   the kid registers a passkey on their own device. The old "parent provisions
   on the kid's device" button was removed — see lib/kid-access.js. */

function copyInviteCode() {
  const code = currentFamily && currentFamily.inviteCode;
  if (!code) return;
  const done = () => toast('Invite code copied! 📋');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => done());
  } else {
    const t = document.createElement('textarea');
    t.value = code; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t); done();
  }
}

async function handleRemoveParent(userId) {
  if (!currentFamily) return;
  if (!confirm('Remove this co-parent from the family? They will lose access to the family chat and calendar.')) return;
  try {
    const res = await window.auth.removeMember(userId);
    currentFamily = res.family;
    save('fam_family', currentFamily);
    renderManageFamily();
    toast('Co-parent removed from the family.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ============================================================
   DASHBOARD
============================================================ */
function showDashboard() {
  const now  = new Date();

  // Kids get the SAME interface as parents — one shell, no separate kid UX.
  // (Data is still scoped to the kid and parent-only controls stay hidden via
  // applyRoleScopingToUI; that's permissions, not a different layout.)

  const av = document.getElementById('user-avatar');
  if (av) av.textContent = (sessionUser.name || '?')[0].toUpperCase();
  document.querySelectorAll('#user-name-display, #user-name-display-2').forEach((el) => {
    el.textContent = sessionUser.name || '';
  });
  const roleEl = document.getElementById('sidebar-user-role');
  if (roleEl) roleEl.textContent = isKidSession() ? 'Kid' : 'Parent';
  const kidAvatarEl = document.getElementById('kid-topbar-avatar');
  if (kidAvatarEl) {
    kidAvatarEl.textContent = (sessionUser.name || '?')[0].toUpperCase();
    kidAvatarEl.style.background = kidColorFor(sessionUser.kidId) || 'var(--accent)';
  }

  initTheme();

  weekStart = mondayOf(now);
  monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  miniMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  renderMiniCal();
  renderCalendar();
  renderWidgets();
  renderUploads();
  renderStreak();
  renderManageFamily();
  renderTodayScreen();
  renderChatDockAvatars();
  applyChatDockState('today');

  // Manual events (server-synced with iOS): fetch once up front — until it
  // resolves the calendar renders the localStorage mirror. Also uploads any
  // legacy/offline-queued local events (one-time migration off fam_events).
  loadFamilyEvents();

  // Homework (Phase 3): load once up front so calendar "due" chips render on
  // first paint; the Homework tab reloads on its own each time it's opened.
  loadHomework().then(() => { renderCalendar(); applyEnrichmentGating(); updateHomeworkBadge(); renderTodayScreen(); });

  // Goals (Phase W3): load once up front so Today's habits card renders real
  // check-ins on first paint; the Goals tab reloads on its own when opened.
  loadGoals().then(() => renderTodayScreen());

  // Notes: load once up front so the Notes tab is ready and pin affordances
  // elsewhere have fresh state; the Notes tab reloads on its own when opened.
  loadNotes();

  // School calendar: load subscriptions then auto-sync (throttled ~1/hour
  // both client- and server-side) — fire-and-forget so the dashboard never
  // blocks on a slow feed fetch.
  loadSchoolFeedsInfo().then(() => {
    renderSchoolSettings();
    syncSchoolCalendar({ silent: false, showToast: false });
    renderTodayScreen();
  });

  // Moodle IDs (extension auto-sync): load once up front, same lifecycle as
  // the other Settings sections above — cheap GET, no need to gate the rest
  // of the dashboard on it.
  loadSchoolKidMappings().then(() => renderMoodleIdsSettings());

  // School stats (house points/attendance/canteen) — purely localStorage-
  // sourced (populated by the extension's famImportSchoolData bridge calls),
  // so this just renders whatever's already stored; no network round-trip.
  renderSchoolStatsWidget();

  // Chat is a core part of the dashboard (not a separate tab) — load + poll
  // it as soon as the dashboard is shown. switchNavTab() takes over the
  // start/stop lifecycle from here on as the user navigates between tabs.
  loadChatMessages();
  startChatPolling();
}

/* ============================================================
   MINI CALENDAR
============================================================ */
function renderMiniCal() {
  const d     = miniMonth;
  const today = isoDate(new Date());
  const evDates = new Set(visibleEvents().flatMap(eventSpanDates));
  const names = ['S','M','T','W','T','F','S'];

  document.getElementById('mini-cal-month').textContent =
    d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('mini-cal-grid');
  grid.innerHTML = names.map(n => `<div class="mini-day-hdr">${n}</div>`).join('');

  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);

  for (let i = 0; i < first.getDay(); i++) grid.innerHTML += '<div></div>';

  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(d.getFullYear(), d.getMonth(), day);
    const ds   = isoDate(date);
    let cls = 'mini-day';
    if (ds === today)        cls += ' today';
    if (evDates.has(ds))     cls += ' has-event';
    grid.innerHTML += `<div class="${cls}" onclick="jumpTo('${ds}')">${day}</div>`;
  }
}

function miniCalPrev() { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1); renderMiniCal(); }
function miniCalNext() { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1); renderMiniCal(); }

function jumpTo(ds) {
  const d = parseIso(ds);
  if (currentView === 'week') {
    weekStart = mondayOf(d);
  } else {
    monthDate = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  renderCalendar();
}

/* ============================================================
   MAIN CALENDAR
============================================================ */
function setCalView(v) {
  currentView = v;
  document.getElementById('btn-week').classList.toggle('active', v === 'week');
  document.getElementById('btn-month').classList.toggle('active', v === 'month');
  renderCalendar();
}

function calPrev() {
  if (currentView === 'week') weekStart = new Date(+weekStart - 7 * 86400000);
  else monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
  renderCalendar();
}

function calNext() {
  if (currentView === 'week') weekStart = new Date(+weekStart + 7 * 86400000);
  else monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
  renderCalendar();
}

/* Normalize a server school-feed event (ISO start/end, possibly all-day)
   into the same {date, time, endTime, category, title} shape manual events
   use, so week/month rendering doesn't need two code paths. School events
   are always read-only and carry source:"school" + a feedId/uid for the
   detail modal's lock affordance. */
function normalizeSchoolEvent(ev) {
  const startDate = ev.allDay ? ev.start : (ev.start || '').slice(0, 10);
  const time = (!ev.allDay && ev.start && ev.start.length > 10) ? ev.start.slice(11, 16) : '';
  const endTime = (!ev.allDay && ev.end && ev.end.length > 10) ? ev.end.slice(11, 16) : '';
  return {
    id: 'school-' + ev.subscriptionId + '-' + ev.uid,
    uid: ev.uid,
    subscriptionId: ev.subscriptionId,
    title: ev.title,
    date: startDate,
    time,
    endTime,
    category: ev.isDeadline ? 'other' : (ev.feedId === 'sta-hs-sport' ? 'sports' : 'school'),
    notes: ev.description || '',
    location: ev.location || '',
    kidId: ev.kidId || null,
    source: 'school',
    readOnly: true,
    isDeadline: !!ev.isDeadline,
    feedLabel: ev.feedLabel,
    recurring: !!ev.recurring,
  };
}

// Manual + school events merged, before any kid filter — shared by
// visibleEvents() (respects the Calendar screen's kid switcher) and
// renderTodaySchedule() (always whole-family, no switcher on Today).
function allEvents() {
  return getEvents().concat(schoolEvents.map(normalizeSchoolEvent));
}

function visibleEvents() {
  const merged = allEvents();
  if (!activeKidId) return merged;
  // A filtered view (parent tapping a kid chip, or a kid session which pins
  // activeKidId to itself) is "that kid's calendar": their own events PLUS
  // every whole-family event (kidId == null covers both null and undefined) —
  // family events must never be hidden just because a kid filter is active.
  return merged.filter(e => e.kidId === activeKidId || e.kidId == null || (e.source === 'school' && !e.kidId));
}

function renderCalendar() {
  currentView === 'week' ? renderWeekView() : renderMonthView();
  renderCalendarFooter();
}

// Horizon event styling: a left bar in the owning kid's color (violet for
// school/whole-family events with no kidId), mono start time, and an
// "all day" marker for events with no time set — shared by week + month.
function eventBarColor(ev) {
  return ev.kidId ? (kidColorFor(ev.kidId) || 'var(--c-violet)') : 'var(--c-violet)';
}

// "Repeats weekly until Jul 30" — occurrences carry `repeat`/`repeatUntil`
// from the series (see lib/events.js makeOccurrence); fall back to a generic
// label if a server ever sends recurring:true without the repeat field.
const REPEAT_LABELS = { daily: 'daily', weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly' };
function repeatLabel(ev) {
  if (!ev || !ev.recurring) return '';
  let label = `Repeats ${REPEAT_LABELS[ev.repeat] || ''}`.trim();
  if (ev.repeatUntil) label += ` until ${formatShort(parseIso(ev.repeatUntil))}`;
  return label;
}

// All ISO dates an event spans (date..endDate inclusive) — used by the
// mini-cal to mark every day a multi-day event covers.
function eventSpanDates(ev) {
  const end = ev.endDate || ev.date;
  if (end <= ev.date) return [ev.date];
  const out = [];
  for (let d = parseIso(ev.date); isoDate(d) <= end; d = new Date(+d + 86400000)) out.push(isoDate(d));
  return out;
}
const allDayIconSvg = '<svg class="evt-allday-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5z"></path><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"></path></svg>';

function renderWeekView() {
  const today  = isoDate(new Date());
  const events = visibleEvents();
  const days   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weekEnd = new Date(+weekStart + 6 * 86400000);

  document.getElementById('cal-title').textContent =
    `${formatShort(weekStart)} – ${formatShort(weekEnd)}, ${weekEnd.getFullYear()}`;

  let html = '<div class="week-view">';
  for (let i = 0; i < 7; i++) {
    const d   = new Date(+weekStart + i * 86400000);
    const ds  = isoDate(d);
    const isT = ds === today;
    const isW = i >= 5;
    const evs = events.filter(e => e.date <= ds && (e.endDate || e.date) >= ds);
    const dueHw = visibleHomeworkDueItems().filter(h => h.dueDate === ds);
    html += `<div class="week-day-col${isT?' is-today':''}${isW?' is-weekend':''}">
      <div class="week-day-col-hdr">
        <div class="wday-name">${days[i]}${isT ? ' · today' : ''}</div>
        <div class="wday-num">${d.getDate()}</div>
      </div>
      <div class="week-day-events">
        ${dueHw.map(h => {
          const overdue = h.dueDate < today;
          return `<div class="week-evt hw-due-chip${overdue ? ' hw-due-overdue' : ''}" onclick="switchNavTab('homework');openHomeworkDetail('${h.id}')" title="Homework due">
            <span class="hw-due-icon">📚</span>${esc(h.title)}
          </div>`;
        }).join('')}
        ${evs.map(ev => {
          const isCont = ev.date !== ds; // continuation day of a multi-day event
          const rLabel = repeatLabel(ev);
          return `
          <div class="week-evt${ev.source === 'school' ? ' school-evt' : ''}${isCont ? ' evt-continuation' : ''}" style="border-left-color:${eventBarColor(ev)}" onclick="showDetail('${ev.id}','${ev.occurrenceDate || ev.date}')"${rLabel ? ` title="${esc(rLabel)}"` : ''}>
            <span class="evt-time">${ev.time ? fmt12(ev.time) : `All day ${allDayIconSvg}`}</span>
            <span class="evt-title">${ev.source === 'school' ? '<span class="school-badge" title="Synced from school calendar — read-only">🎓</span>' : ''}${ev.recurring ? `<span class="evt-repeat-badge">↻</span>` : ''}${esc(ev.title)}</span>
          </div>`;
        }).join('')}
        <button class="week-add-btn" onclick="openAddEventModal('${ds}')">+ Add</button>
      </div>
    </div>`;
  }
  html += '</div>';
  document.getElementById('calendar-grid').innerHTML = html;
}

// Footer legend + sync status (canvas 1b) — kid colors from the same family
// order as kidColorFor, plus real school-feed sync state (schoolFeedsInfo /
// schoolEvents), not invented numbers.
function renderCalendarFooter() {
  const el = document.getElementById('calendar-footer');
  if (!el) return;
  const kids = (currentFamily && currentFamily.kids) || [];
  const kidLegend = kids.map((k) =>
    `<span class="cal-legend-item"><span class="cal-legend-swatch" style="background:${kidColorFor(k.id) || 'var(--c-violet)'}"></span>${esc(k.name)}</span>`
  ).join('');

  const monday = mondayOf(new Date());
  const sunday = new Date(+monday + 6 * 86400000);
  const weekEventCount = schoolEvents
    .map(normalizeSchoolEvent)
    .filter((ev) => ev.date >= isoDate(monday) && ev.date <= isoDate(sunday)).length;
  const syncedText = (schoolFeedsInfo && schoolFeedsInfo.lastSyncAt)
    ? `Synced ${timeAgo(schoolFeedsInfo.lastSyncAt)} · ${weekEventCount} school event${weekEventCount === 1 ? '' : 's'} this week`
    : 'Not synced yet';

  el.innerHTML = `
    ${kidLegend}
    <span class="cal-legend-item"><span class="cal-legend-swatch" style="background:var(--c-violet)"></span>School feed</span>
    <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-dashed"></span>Homework due</span>
    <span class="cal-sync-status micro-label">${esc(syncedText)}</span>`;
}

function renderMonthView() {
  const today  = isoDate(new Date());
  const events = visibleEvents();
  const d      = monthDate;
  const dayHdrs = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  document.getElementById('cal-title').textContent =
    d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);

  let html = '<div class="month-view">';
  html += dayHdrs.map(n => `<div class="month-day-hdr">${n}</div>`).join('');

  // Blank leading cells
  for (let i = 0; i < first.getDay(); i++) {
    html += '<div class="month-day other-month"></div>';
  }

  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(d.getFullYear(), d.getMonth(), day);
    const ds   = isoDate(date);
    const isT  = ds === today;
    const evs  = events.filter(e => e.date <= ds && (e.endDate || e.date) >= ds);
    const dueHw = visibleHomeworkDueItems().filter(h => h.dueDate === ds);
    html += `<div class="month-day${isT?' is-today':''}" onclick="openAddEventModal('${ds}')">
      <span class="mday-num">${day}</span>
      ${dueHw.slice(0,3).map((h) => {
        const overdue = h.dueDate < today;
        return `<span class="month-evt hw-due-chip${overdue ? ' hw-due-overdue' : ''}" onclick="event.stopPropagation();switchNavTab('homework');openHomeworkDetail('${h.id}')" title="Homework due">📚 ${esc(h.title)}</span>`;
      }).join('')}
      ${evs.slice(0,3).map((ev) => {
        const isCont = ev.date !== ds;
        const rLabel = repeatLabel(ev);
        return `<span class="month-evt${ev.source === 'school' ? ' school-evt' : ''}${isCont ? ' evt-continuation' : ''}" style="border-left-color:${eventBarColor(ev)}" onclick="event.stopPropagation();showDetail('${ev.id}','${ev.occurrenceDate || ev.date}')"${rLabel ? ` title="${esc(rLabel)}"` : ''}>${ev.source === 'school' ? '🎓 ' : ''}${ev.recurring ? '↻ ' : ''}${esc(ev.title)}</span>`;
      }).join('')}
      ${evs.length > 3 ? `<span class="month-more">+${evs.length-3} more</span>` : ''}
    </div>`;
  }
  html += '</div>';
  document.getElementById('calendar-grid').innerHTML = html;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   MOODLE IDs (Settings "School (Moodle) IDs" card)
   Lets a parent store each kid's Moodle numeric user id. This is what
   drives the Chrome extension's auto-sync: the extension's background
   service worker injects window.famGetSchoolMappings() into an open
   fametc.com tab to learn which kids to import homework/timetable for —
   see chrome-extension/background.js and content.js.
============================================================ */
async function loadSchoolKidMappings() {
  if (isKidSession()) { schoolKidMappings = []; return schoolKidMappings; }
  try {
    const status = await window.auth.getSchoolStatus();
    schoolKidMappings = (status && status.kidMappings) || [];
  } catch (e) {
    schoolKidMappings = [];
  }
  return schoolKidMappings;
}

function renderMoodleIdsSettings() {
  const el = document.getElementById('moodle-ids-list');
  if (!el || isKidSession()) return;

  const kids = (currentFamily && currentFamily.kids) || [];
  if (!kids.length) {
    el.innerHTML = '<p class="text-muted">Add a kid profile first (below) to set up Moodle sync.</p>';
    return;
  }

  el.innerHTML = kids.map((k) => {
    const mapping = schoolKidMappings.find((m) => m.kidId === k.id);
    const value = mapping ? esc(mapping.moodleUserId) : '';
    return `<div class="kid-row" id="moodle-id-row-${k.id}">
      <span class="kid-row-swatch" style="background:${kidColorFor(k.id) || k.color}"></span>
      <span class="kid-row-name">${esc(k.name)}</span>
      <input type="text" inputmode="numeric" placeholder="Moodle id, e.g. 14197"
        id="moodle-id-input-${k.id}" value="${value}" style="width:140px;margin:0 8px">
      <button type="button" class="btn-secondary" onclick="handleSaveMoodleId('${k.id}')">Save</button>
    </div>`;
  }).join('');
}

async function handleSaveMoodleId(kidId) {
  const input = document.getElementById(`moodle-id-input-${kidId}`);
  if (!input) return;
  const value = input.value.trim();
  if (!/^\d+$/.test(value)) {
    toast('❌ Enter a numeric Moodle user id.');
    return;
  }
  try {
    await window.auth.setKidMoodleId(kidId, value);
    const idx = schoolKidMappings.findIndex((m) => m.kidId === kidId);
    if (idx >= 0) schoolKidMappings[idx].moodleUserId = value;
    else schoolKidMappings.push({ kidId, moodleUserId: value });
    toast('Moodle id saved! 🆔');
  } catch (err) {
    toast(`❌ ${(err && err.message) || 'Could not save Moodle id.'}`);
  }
}

// STABLE global read by the Chrome extension (background.js) via
// chrome.scripting.executeScript world:"MAIN" — returns which kids have a
// Moodle id set, so auto-sync knows who to import for. Kid sessions never
// expose mappings (they can't see/edit them either — see applyRoleScopingToUI).
function famGetSchoolMappings() {
  if (isKidSession() || !currentFamily) return [];
  const kids = currentFamily.kids || [];
  const out = [];
  for (const m of schoolKidMappings) {
    if (!m || !m.moodleUserId) continue;
    const kid = kids.find((k) => k.id === m.kidId);
    if (!kid) continue;
    out.push({ kidId: m.kidId, kidName: kid.name || '', moodleUserId: m.moodleUserId });
  }
  return out;
}
window.famGetSchoolMappings = famGetSchoolMappings;

/* ============================================================
   EVENTS — ADD / VIEW / DELETE
============================================================ */
// Audience ("For") select: whole family (default, kidId null) or one specific
// kid. Kid sessions may only target themselves or the family — never a
// sibling — mirroring the server's own coercion (see calendar.js PATCH/POST).
function populateEventAudienceOptions(selected) {
  const sel = document.getElementById('event-audience');
  if (!sel) return;
  const kids = isKidSession()
    ? (currentFamily?.kids || []).filter((k) => k.id === sessionUser.kidId)
    : (currentFamily?.kids || []);
  sel.innerHTML = ['<option value="family">👨‍👩‍👧‍👦 Whole family</option>']
    .concat(kids.map((k) => {
      const color = kidColorFor(k.id) || k.color || 'var(--accent)';
      return `<option value="${esc(k.id)}" style="color:${color}">${esc(k.name)}</option>`;
    })).join('');
  sel.value = selected && sel.querySelector(`option[value="${selected}"]`) ? selected : 'family';
}

function openAddEventModal(ds) {
  editingEventId = null; // adding fresh — make sure a stale edit session can't hijack this save
  pendingDate = ds || null;
  const startDate = ds || isoDate(new Date());
  document.getElementById('event-title').value   = '';
  document.getElementById('event-date').value    = startDate;
  document.getElementById('event-time').value    = '';
  document.getElementById('event-end-time').value= '';
  document.getElementById('event-notes').value   = '';
  document.getElementById('event-end-date').value = '';
  document.getElementById('event-end-date').min   = startDate;
  document.getElementById('event-repeat').value  = 'none';
  document.getElementById('event-repeat-until').value = '';
  document.getElementById('event-repeat-until-group').style.display = 'none';
  document.querySelector('input[name="cat"][value="school"]').checked = true;
  populateEventAudienceOptions('family');
  setAddEventModalMode(false);
  openModal('add-event-modal');
}

// Prefills the add/edit modal from an existing event and switches saveEvent()
// into PATCH mode via editingEventId. Recurring edits apply to the whole
// series server-side, so surface a one-line hint rather than pretending this
// is a single-occurrence edit.
function openEditEventModal(ev) {
  editingEventId = ev.id;
  pendingDate = null;
  const startDate = ev.date || isoDate(new Date());
  document.getElementById('event-title').value    = ev.title || '';
  document.getElementById('event-date').value     = startDate;
  document.getElementById('event-time').value     = ev.time || '';
  document.getElementById('event-end-time').value = ev.endTime || '';
  document.getElementById('event-notes').value    = ev.notes || '';
  document.getElementById('event-end-date').value = ev.endDate || '';
  document.getElementById('event-end-date').min    = startDate;
  document.getElementById('event-repeat').value    = ev.repeat || (ev.recurring ? 'weekly' : 'none');
  document.getElementById('event-repeat-until').value = ev.repeatUntil || '';
  const repeats = document.getElementById('event-repeat').value !== 'none';
  document.getElementById('event-repeat-until-group').style.display = repeats ? '' : 'none';
  const catRadio = document.querySelector(`input[name="cat"][value="${ev.category}"]`);
  if (catRadio) catRadio.checked = true;
  else document.querySelector('input[name="cat"][value="other"]').checked = true;
  populateEventAudienceOptions(ev.kidId || 'family');
  setAddEventModalMode(true, repeats);
  openModal('add-event-modal');
}

function setAddEventModalMode(isEdit, isRecurring) {
  const titleEl = document.getElementById('add-event-modal-title');
  if (titleEl) titleEl.textContent = isEdit ? '✏️ Edit Event' : '✏️ Add New Event';
  const submitBtn = document.getElementById('add-event-submit-btn');
  if (submitBtn) submitBtn.textContent = isEdit ? 'Save Changes 💾' : 'Save Event 🎯';
  const hint = document.getElementById('edit-event-recurring-hint');
  if (hint) hint.style.display = (isEdit && isRecurring) ? '' : 'none';
}

function editCurrentEvent() {
  if (!activeEventId || !activeEventObj) return;
  closeModal('event-detail-modal');
  openEditEventModal(activeEventObj);
}

function onEventRepeatChange() {
  const repeats = document.getElementById('event-repeat').value !== 'none';
  document.getElementById('event-repeat-until-group').style.display = repeats ? '' : 'none';
  if (editingEventId) {
    const hint = document.getElementById('edit-event-recurring-hint');
    if (hint) hint.style.display = repeats ? '' : 'none';
  }
}

/* Manual events are server-synced family data (/api/calendar/events — the same
   store the iOS app reads/writes), so an event added here shows up on every
   device. The server posts the family-chat announcement on POST, so the web no
   longer sends its own (that would double-post). localStorage 'fam_events' is
   only the offline mirror + pending-upload queue — see loadFamilyEvents(). */
async function saveEvent(e) {
  e.preventDefault();
  const audience = document.getElementById('event-audience').value;
  const payload = {
    kidId:    audience === 'family' ? null : audience,
    title:    document.getElementById('event-title').value.trim(),
    date:     document.getElementById('event-date').value,
    time:     document.getElementById('event-time').value,
    endTime:  document.getElementById('event-end-time').value,
    category: document.querySelector('input[name="cat"]:checked').value,
    notes:    document.getElementById('event-notes').value.trim(),
    endDate:  document.getElementById('event-end-date').value || null,
    repeat:   document.getElementById('event-repeat').value,
    repeatUntil: document.getElementById('event-repeat-until').value || null,
  };

  if (editingEventId) {
    const id = editingEventId;
    let updated;
    // Local-only (offline-queued) events have no server id to PATCH — just
    // update the mirror; the next loadFamilyEvents() upload picks it up.
    if (!String(id).startsWith('ev_')) {
      updated = Object.assign({ id }, payload);
    } else {
      try {
        updated = (await window.auth.updateCalendarEvent(id, payload)).event;
      } catch (err) {
        // 403 (not permitted) / 400 (validation) — surface and keep the modal open.
        toast(`❌ ${err.message || 'Could not update that event.'}`);
        return;
      }
    }
    saveEvents(getEvents().map((ev) => (ev.id === id ? Object.assign({}, ev, updated) : ev)));
    editingEventId = null;
    closeModal('add-event-modal');
    toast('Event updated ✏️');
    renderCalendar();
    renderMiniCal();
    if (typeof renderTodayScreen === 'function') renderTodayScreen();
    scheduleReminders();
    return;
  }

  let ev;
  try {
    ev = (await window.auth.addCalendarEvent(payload)).event;
    toast('Event added! 🎯');
  } catch (err) {
    if (err && err.status) { // server rejected it (bad date, kicked session…) — don't queue garbage
      toast(`❌ ${err.message || 'Could not save that event.'}`);
      return;
    }
    // Offline: keep it locally (non-ev_ id) — the next loadFamilyEvents()
    // uploads it silently. The chat announcement is skipped in that case.
    ev = { id: uid(), ...payload };
    toast('Saved on this device — will sync when back online. 📴');
  }
  saveEvents(getEvents().concat([ev]));
  closeModal('add-event-modal');
  renderCalendar();
  renderMiniCal();
  scheduleReminders();
}

/* Fetch the family's server events, then upload anything still sitting in
   localStorage without a server id ('ev_' prefix): legacy pre-migration events
   (one-time migration) and offline-queued adds. Uploads are silent — no chat
   flood — and dedup by date|time|title|kid so a re-run never duplicates.
   Queued back-to-back (bulk imports call this too) so runs never interleave. */
let famEventsSync = null;
function loadFamilyEvents() {
  const run = async () => {
    let serverEvents;
    try {
      serverEvents = await window.auth.getCalendarEvents();
    } catch (e) {
      return; // offline — keep rendering the localStorage mirror
    }
    const evKey = (ev) => `${ev.date}|${ev.time || ''}|${String(ev.title || '').trim().toLowerCase()}|${ev.kidId || ''}`;
    const seen = new Set(serverEvents.map(evKey));
    const pending = [];
    for (const ev of getEvents()) {
      if (String(ev.id).startsWith('ev_') || seen.has(evKey(ev))) continue;
      try {
        const res = await window.auth.addCalendarEvent({
          title: ev.title, date: ev.date, time: ev.time || '', endTime: ev.endTime || '',
          notes: ev.notes || '', category: ev.category, kidId: ev.kidId || null, silent: true,
        });
        serverEvents.push(res.event);
        seen.add(evKey(res.event));
      } catch (e) {
        if (e && e.status) continue; // server rejected it (e.g. bad legacy date) — drop, don't retry forever
        pending.push(ev); // network hiccup — keep locally, retried next load
      }
    }
    saveEvents(serverEvents.concat(pending));
    renderCalendar();
    renderMiniCal();
    renderTodayScreen();
    scheduleReminders();
  };
  famEventsSync = (famEventsSync || Promise.resolve()).then(run, run);
  return famEventsSync;
}

function showDetail(id, occDate) {
  // School events live in server state (schoolEvents), not localStorage —
  // look there first via the normalized id shape ('school-<subId>-<uid>').
  // Recurring occurrences share their series' `id`, so match on occDate
  // (the occurrence's own date) too — otherwise two occurrences of the same
  // series would always resolve to whichever one getEvents() finds first.
  const ev = String(id).startsWith('school-')
    ? visibleEvents().find(e => e.id === id)
    : getEvents().find(e => e.id === id && (!occDate || (e.occurrenceDate || e.date) === occDate));
  if (!ev) return;
  activeEventId = id;
  activeEventObj = ev;
  activeEventRecurring = !!ev.recurring && ev.source !== 'school';

  const catLabel = { school:'🏫 School', sports:'⚽ Sports', arts:'🎨 Arts', social:'👫 Social', other:'⭐ Other' };
  const badge = document.getElementById('detail-badge');
  badge.textContent  = (ev.source === 'school' ? '🎓 ' : '') + (ev.isDeadline ? 'Deadline' : (catLabel[ev.category] || ev.category));
  badge.className    = `detail-category-badge chip-${ev.category}`;

  document.getElementById('detail-title').textContent = ev.title;
  document.getElementById('detail-date').textContent  = formatLong(parseIso(ev.date));
  document.getElementById('detail-time').textContent  = ev.time
    ? `${fmt12(ev.time)}${ev.endTime ? ' – ' + fmt12(ev.endTime) : ''}`
    : 'All day';
  const notesRow = document.getElementById('detail-notes-row');
  const notesParts = [ev.notes, ev.location ? `📍 ${ev.location}` : ''].filter(Boolean);
  if (notesParts.length) {
    document.getElementById('detail-notes').textContent = notesParts.join(' · ');
    notesRow.style.display = '';
  } else {
    notesRow.style.display = 'none';
  }

  // "Through <date>" (multi-day span) and "Repeats <cadence>" — manual events
  // only; school-feed recurrence is already surfaced via the lock hint below.
  const throughRow = document.getElementById('detail-through-row');
  if (ev.source !== 'school' && ev.endDate) {
    document.getElementById('detail-through').textContent = `Through ${formatLong(parseIso(ev.endDate))}`;
    throughRow.style.display = '';
  } else {
    throughRow.style.display = 'none';
  }
  const repeatRow = document.getElementById('detail-repeat-row');
  const rLabel = ev.source !== 'school' ? repeatLabel(ev) : '';
  if (rLabel) {
    document.getElementById('detail-repeat').textContent = rLabel;
    repeatRow.style.display = '';
  } else {
    repeatRow.style.display = 'none';
  }

  // School events are read-only for kids (synced from the school's calendar)
  // — hide edit/delete and show a lock hint instead. Parents can delete (hide)
  // a school event too; it stays hidden across future syncs. School events are
  // never editable (they're synced from the feed, not authored here).
  const editBtn = document.getElementById('btn-edit-event');
  const deleteBtn = document.getElementById('btn-delete-event');
  const lockHint = document.getElementById('detail-readonly-hint');
  if (ev.source === 'school') {
    editBtn.style.display = 'none';
    if (isKidSession()) {
      deleteBtn.style.display = 'none';
      if (lockHint) {
        lockHint.style.display = '';
        lockHint.textContent = `🔒 Synced from ${ev.feedLabel || 'the school calendar'} — read-only.` + (ev.recurring ? ' Repeats — showing the next occurrence.' : '');
      }
    } else {
      deleteBtn.style.display = '';
      if (lockHint) {
        lockHint.style.display = '';
        lockHint.textContent = `🎓 Synced from ${ev.feedLabel || 'the school calendar'}.` + (ev.recurring ? ' Repeats — showing the next occurrence.' : '') + ' Deleting hides it from Fam ETC only.';
      }
    }
  } else {
    // Manual events are family-shared on the server now. `canEdit` (creator-or-
    // parent, computed server-side) gates Edit + Delete together — kids can now
    // manage their OWN events, parents manage all, nobody else sees the buttons.
    // Offline local-only events (non-'ev_' id) were authored on this device and
    // have no canEdit from the server, so treat them as manageable.
    const localOnly = !String(ev.id).startsWith('ev_');
    const manageable = localOnly || !!ev.canEdit;
    editBtn.style.display = manageable ? '' : 'none';
    deleteBtn.style.display = manageable ? '' : 'none';
    if (lockHint) lockHint.style.display = 'none';
  }

  openModal('event-detail-modal');
}

async function deleteCurrentEvent() {
  if (!activeEventId) return;
  if (String(activeEventId).startsWith('school-')) {
    if (isKidSession()) return;
    const ev = visibleEvents().find(e => e.id === activeEventId);
    if (!ev) return;
    try {
      await window.auth.hideSchoolEvent(ev.subscriptionId, ev.uid);
      schoolEvents = schoolEvents.filter(e => !(e.subscriptionId === ev.subscriptionId && e.uid === ev.uid));
      closeModal('event-detail-modal');
      renderCalendar();
      renderMiniCal();
      toast('School event removed 🎓');
      activeEventId = null;
      activeEventObj = null;
    } catch (err) {
      toast(`❌ ${err.message || 'Could not remove that event.'}`);
    }
    return;
  }
  // Deleting a recurring event removes the whole series server-side — confirm
  // that explicitly so a tap on one occurrence doesn't silently wipe them all.
  if (activeEventRecurring && !confirm('Delete this event and all its repeats?')) return;
  // Server-synced manual event ('ev_' id): delete on the server first so it
  // disappears everywhere (iOS too). Events without a server id are still
  // local-only (offline-queued) and just get dropped from the mirror.
  if (String(activeEventId).startsWith('ev_')) {
    try {
      await window.auth.deleteCalendarEvent(activeEventId);
    } catch (err) {
      toast(`❌ ${err.message || 'Could not delete that event.'}`);
      return;
    }
  }
  saveEvents(getEvents().filter(e => e.id !== activeEventId));
  closeModal('event-detail-modal');
  renderCalendar();
  renderMiniCal();
  toast('Event deleted.');
  activeEventId = null;
  activeEventObj = null;
}

/* ============================================================
   UPLOAD / SCHEDULES
============================================================ */
function openUploadModal() {
  clearUpload();
  document.getElementById('schedule-name').value = '';
  openModal('upload-modal');
}

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.add('dragover');
}

function handleDragLeave() {
  document.getElementById('upload-zone').classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processUpload(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processUpload(file);
}

function processUpload(file) {
  uploadedFile = file;
  if (!document.getElementById('schedule-name').value) {
    document.getElementById('schedule-name').value = file.name.replace(/\.[^.]+$/, '');
  }
  document.getElementById('preview-filename').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;

  const reader = new FileReader();
  reader.onload = ev => {
    const content = document.getElementById('preview-content');
    if (file.type.startsWith('image/')) {
      content.innerHTML = `<img src="${ev.target.result}" alt="Schedule preview">`;
    } else if (file.type === 'application/pdf') {
      content.innerHTML = `<iframe src="${ev.target.result}" title="Schedule PDF"></iframe>`;
    } else {
      content.innerHTML = `<div style="padding:16px;color:var(--text-2)">Preview not available for this file type.</div>`;
    }
    document.getElementById('upload-preview').style.display = '';
    uploadedFile._dataUrl = ev.target.result;

    // Auto-parse — AI parsing runs server-side (POST /api/ai/parse), so it's
    // available whenever the user is signed in.
    document.getElementById('ai-parse-section').style.display = '';
    setParseStatus('⏳', 'Parsing schedule with AI…');
    parseScheduleWithAI();
  };
  reader.readAsDataURL(file);
}

function clearUpload() {
  uploadedFile = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('preview-content').innerHTML = '';
  document.getElementById('file-input').value = '';
  document.getElementById('ai-parse-section').style.display = 'none';
}

function saveSchedule() {
  if (!uploadedFile || !uploadedFile._dataUrl) { toast('Please select a file first!'); return; }
  const name = document.getElementById('schedule-name').value.trim() || uploadedFile.name;
  const schedules = getSchedules();
  schedules.push({
    id:         uid(),
    userId:     sessionUser.id,
    name,
    filename:   uploadedFile.name,
    type:       uploadedFile.type,
    data:       uploadedFile._dataUrl,
    uploadedAt: new Date().toISOString(),
  });
  saveSched(schedules);
  closeModal('upload-modal');
  renderUploads();
  toast('Schedule saved! 📚');
}

function renderUploads() {
  const list = document.getElementById('uploads-list');
  const mine = getSchedules().filter(s => s.userId === sessionUser.id);
  list.innerHTML = mine.map(s =>
    `<div class="upload-item">
      <span>${s.type === 'application/pdf' ? '📄' : '🖼️'}</span>
      <span class="upload-item-name" onclick="viewSchedule('${s.id}')">${esc(s.name)}</span>
      <button class="upload-delete-btn" onclick="deleteSchedule('${s.id}')" title="Delete schedule">×</button>
    </div>`
  ).join('');
}

function deleteSchedule(id) {
  saveSched(getSchedules().filter(s => s.id !== id));
  renderUploads();
  toast('Schedule removed.');
}

function viewSchedule(id) {
  const s = getSchedules().find(x => x.id === id);
  if (!s) return;
  document.getElementById('view-schedule-title').textContent = `📋 ${s.name}`;
  const content = document.getElementById('view-schedule-content');
  if (s.type.startsWith('image/')) {
    content.innerHTML = `<img src="${s.data}" alt="${esc(s.name)}" style="width:100%;height:auto;display:block">`;
  } else {
    content.innerHTML = `<iframe src="${s.data}" title="${esc(s.name)}" style="width:100%;height:500px;border:none;display:block"></iframe>`;
  }
  openModal('view-schedule-modal');
}

/* ============================================================
   WIDGETS
============================================================ */
/* Daily 5 completion — once the day's word activity / brain teaser is
   answered, the interactive blocks leave the Today view for the rest of the
   day (the word, quote, and news stay). Per-user, per-local-day. */
function daily5DoneKey() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return `fam_daily5_done_${sessionUser ? sessionUser.id : 'anon'}_${ymd}`;
}
function markDaily5Done(part) {
  const s = load(daily5DoneKey()) || {};
  s[part] = true;
  save(daily5DoneKey(), s);
  applyDaily5Done();
}
function applyDaily5Done() {
  const s = load(daily5DoneKey()) || {};
  if (s.sat) {
    ['sat-placement', 'sat-activity', 'sat-wordbank-panel', 'sat-quiz-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    const footer = document.querySelector('#widget-word .fam-sat-footer');
    if (footer) footer.hidden = true;
  }
  if (s.bt) {
    const bt = document.getElementById('widget-quiz');
    if (bt) bt.hidden = true;
  }
}

function renderWidgets() {
  const now = new Date();

  // Quote
  const q = dailyPick(QUOTES, now);
  currentQuote = q;
  document.getElementById('quote-text').textContent   = q.text;
  document.getElementById('quote-author').textContent = `— ${q.author}`;
  flipQuoteCard(false);
  document.getElementById('quote-reflect-prompt').textContent = 'What does this quote mean to you today?';
  document.getElementById('quote-reflect-text').value = '';

  // SAT Word
  const w = dailyPick(SAT_WORDS, now);
  currentSatWord = w;
  document.getElementById('sat-word').textContent    = w.word;
  document.getElementById('sat-pos').textContent     = w.pos;
  document.getElementById('sat-def').textContent     = w.def;
  document.getElementById('sat-example').textContent = `"${w.example}"`;
  renderSatActivity();
  loadWordBank();

  // News
  const n = dailyPick(NEWS_ITEMS, now);
  currentNews = n;
  document.getElementById('news-badge').textContent    = n.cat;
  const newsHeadlineEl = document.getElementById('news-headline');
  if (newsHeadlineEl) { newsHeadlineEl.textContent = n.headline; newsHeadlineEl.href = newsArticleLink(n); }
  document.getElementById('news-summary').textContent  = n.summary;
  const newsLink = document.getElementById('news-link');
  if (newsLink) newsLink.href = newsArticleLink(n);
  document.getElementById('news-reflect-prompt').textContent = 'Why do you think this matters, and how does it make you feel?';
  document.getElementById('news-reflect-text').value = '';

  // Brain teaser (server-backed, day-ramped)
  loadBrainTeaser();

  applyEnrichmentGating();
  applyDaily5Done();
}

/* ============================================================
   BRAIN TEASER (server-backed — GET /api/brainteaser/today,
   POST /api/brainteaser/answer). Day-ramped question count (Mon1..Fri5,
   weekend 3), resurfacing previously-wrong questions with shuffled options.
   Falls back to the local QUIZ bank if the server route isn't reachable yet.
============================================================ */
let brainTeaserQuestions = []; // [{qid,q,options,answerIndex,resurfaced}]
let brainTeaserIndex     = 0;
let brainTeaserAnswered  = false;

async function loadBrainTeaser() {
  try {
    const res = await window.auth.getBrainTeaserToday();
    brainTeaserQuestions = (res && res.questions) || [];
  } catch (e) {
    // Contract mismatch / route not up yet — fall back to the local bank so
    // the widget still works, using the same weekday ramp.
    const now = new Date();
    const day = now.getDay(); // 0=Sun..6=Sat
    const count = (day === 0 || day === 6) ? 3 : [0,1,2,3,4,5][day] || 1;
    const baseIdx = dayOfYear(now) % QUIZ.length;
    brainTeaserQuestions = [];
    for (let i = 0; i < count; i++) {
      const q = QUIZ[(baseIdx + i) % QUIZ.length];
      brainTeaserQuestions.push({ qid: `local_${(baseIdx + i) % QUIZ.length}`, q: q.q, options: q.opts, answerIndex: q.ans, resurfaced: false, _exp: q.exp });
    }
  }
  brainTeaserIndex = 0;
  renderBrainTeaser();
}

function renderBrainTeaser() {
  const progressEl = document.getElementById('bt-progress');
  const total = brainTeaserQuestions.length;
  if (!total) {
    document.getElementById('quiz-question').textContent = 'No brain teasers to show right now — check back tomorrow!';
    document.getElementById('quiz-options').innerHTML = '';
    document.getElementById('quiz-feedback').textContent = '';
    document.getElementById('btn-next-q').style.display = 'none';
    if (progressEl) progressEl.textContent = '';
    return;
  }
  brainTeaserAnswered = false;
  const q = brainTeaserQuestions[brainTeaserIndex];
  if (progressEl) progressEl.textContent = `${brainTeaserIndex + 1}/${total}`;
  document.getElementById('quiz-question').innerHTML =
    (q.resurfaced ? '<span class="fam-bt-hint">👀 seen before</span> ' : '') + esc(q.q);
  document.getElementById('quiz-options').innerHTML = q.options.map((opt, i) =>
    `<button class="quiz-opt" onclick="answerBrainTeaserQ(${i})">${esc(opt)}</button>`
  ).join('');
  document.getElementById('quiz-feedback').textContent = '';
  document.getElementById('quiz-feedback').className   = 'quiz-feedback';
  document.getElementById('btn-next-q').style.display  = 'none';
}

async function answerBrainTeaserQ(chosen) {
  if (brainTeaserAnswered) return;
  brainTeaserAnswered = true;
  const q = brainTeaserQuestions[brainTeaserIndex];
  const correct = chosen === q.answerIndex;
  const btns = document.querySelectorAll('.quiz-opt');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.answerIndex) btn.classList.add('correct');
    else if (i === chosen) btn.classList.add('wrong');
  });

  const fb = document.getElementById('quiz-feedback');
  const exp = q.exp || q._exp || '';
  if (correct) {
    fb.textContent = `✅ Correct! ${exp}`;
    fb.className   = 'quiz-feedback correct';
    incrementStreak();
  } else {
    fb.textContent = `❌ Not quite. ${exp}`;
    fb.className   = 'quiz-feedback wrong';
  }
  document.getElementById('btn-next-q').style.display = '';

  if (!String(q.qid || '').startsWith('local_')) {
    try { await window.auth.answerBrainTeaser(q.qid, correct); } catch (e) { /* best effort */ }
  }
}

function nextQuestion() {
  if (brainTeaserIndex < brainTeaserQuestions.length - 1) {
    brainTeaserIndex++;
    renderBrainTeaser();
  } else {
    document.getElementById('quiz-question').textContent = "🎉 That's today's brain teasers done — nice work!";
    document.getElementById('quiz-options').innerHTML = '';
    document.getElementById('quiz-feedback').textContent = '';
    document.getElementById('btn-next-q').style.display = 'none';
    setTimeout(() => markDaily5Done('bt'), 1500);
  }
}

/* ============================================================
   STREAK
============================================================ */
function setStreakDisplays(count) {
  ['streak-count', 'daily5-streak-count'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  });
}

function renderStreak() {
  const key    = `fam_streak_${sessionUser.id}`;
  const streak = load(key) || { count: 0, last: '' };
  setStreakDisplays(streak.count);
}

function incrementStreak() {
  const key    = `fam_streak_${sessionUser.id}`;
  const today  = isoDate(new Date());
  const streak = load(key) || { count: 0, last: '' };
  if (streak.last === today) return; // already answered today
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  streak.count = (streak.last === yesterday) ? streak.count + 1 : 1;
  streak.last  = today;
  save(key, streak);
  setStreakDisplays(streak.count);
}

/* ============================================================
   AI SCHEDULE PARSING (server-side proxy — POST /api/ai/parse)
============================================================ */

let parsedEvents = [];

function guessCategory(subject) {
  const s = (subject || '').toLowerCase();
  if (/\bpe\b|sport|soccer|football|basketball|swim|gym|athletics|hockey|tennis/.test(s)) return 'sports';
  if (/\bdance\b/.test(s)) return 'sports';
  if (/\bart\b|music|drama|theatre|theater|choir|band|orchestra|dance/.test(s)) return 'arts';
  return 'school';
}

function getNextMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun, 1=Mon…
  const daysUntilMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  d.setDate(d.getDate() + daysUntilMon);
  return d;
}

async function renderPdfToBase64(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded yet. Please try again.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/vendor/pdfjs/pdf.worker.min.js';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const pdf  = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
        const page = await pdf.getPage(1);
        const vp   = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/png' });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function setParseStatus(icon, text) {
  const spinner = document.getElementById('ai-spinner');
  const label   = document.getElementById('ai-status-text');
  if (spinner) spinner.textContent = icon;
  if (label)   label.textContent   = text;
}

async function parseScheduleWithAI() {
  try {
    let base64, mediaType;

    if (uploadedFile.type === 'application/pdf') {
      const result = await renderPdfToBase64(uploadedFile);
      base64    = result.base64;
      mediaType = result.mediaType;
    } else {
      const dataUrl = uploadedFile._dataUrl;
      base64    = dataUrl.split(',')[1];
      mediaType = dataUrl.split(',')[0].match(/:(.*?);/)[1];
      // Anthropic only supports jpeg, png, gif, webp
      if (!['image/jpeg','image/png','image/gif','image/webp'].includes(mediaType)) {
        throw new Error('Unsupported image type. Please use JPG or PNG.');
      }
    }

    const { items: events } = await window.auth.parseWithAI('schedule', mediaType, base64);
    if (!Array.isArray(events) || events.length === 0) throw new Error('No events found in the schedule image.');

    setParseStatus('✅', `Found ${events.length} classes — review below`);
    openParseReview(events);

  } catch (err) {
    setParseStatus('❌', `Parse failed: ${err.message}`);
    toast(`❌ ${err.message}`);
    console.error(err);
  }
}

function openParseReview(events) {
  parsedEvents = events;

  // Default to next Monday
  document.getElementById('parse-week-date').value = isoDate(getNextMonday());
  document.getElementById('parse-repeat').value    = '1';

  renderParseTable(events);
  updateParseSummary();
  closeModal('upload-modal');
  openModal('parse-modal');
}

function renderParseTable(events) {
  const tbody = document.getElementById('parse-tbody');
  tbody.innerHTML = events.map((ev, i) => {
    const cat = guessCategory(ev.subject);
    const teacherRoom = [ev.teacher, ev.room].filter(Boolean);
    return `<tr>
      <td><input type="checkbox" class="parse-check" data-i="${i}" checked onchange="updateParseSummary()"></td>
      <td style="font-weight:700;white-space:nowrap">${esc(ev.day || '')}</td>
      <td class="parse-subject">${esc(ev.subject || '')}</td>
      <td><input type="time" class="parse-time" value="${ev.startTime || ''}" data-i="${i}" data-f="startTime" onchange="updateParsedEvent(${i},'startTime',this.value)"></td>
      <td><input type="time" class="parse-time" value="${ev.endTime   || ''}" data-i="${i}" data-f="endTime"   onchange="updateParsedEvent(${i},'endTime',this.value)"></td>
      <td class="parse-teacher">
        ${teacherRoom.length ? esc(teacherRoom[0]) : ''}
        ${ev.room ? `<span class="parse-room">${esc(ev.room)}</span>` : ''}
      </td>
      <td>
        <select onchange="updateParsedEvent(${i},'category',this.value)">
          <option value="school" ${cat==='school'?'selected':''}>🏫 School</option>
          <option value="sports" ${cat==='sports'?'selected':''}>⚽ Sports</option>
          <option value="arts"   ${cat==='arts'  ?'selected':''}>🎨 Arts</option>
          <option value="social" ${cat==='social'?'selected':''}>👫 Social</option>
          <option value="other"  ${cat==='other' ?'selected':''}>⭐ Other</option>
        </select>
      </td>
    </tr>`;
  }).join('');

  // Init category on each event
  events.forEach((ev, i) => { parsedEvents[i].category = guessCategory(ev.subject); });
}

function updateParsedEvent(i, field, value) {
  parsedEvents[i][field] = value;
}

function toggleAllParsed(checked) {
  document.querySelectorAll('.parse-check').forEach(cb => {
    cb.checked = checked;
    cb.closest('tr').classList.toggle('unchecked', !checked);
  });
  updateParseSummary();
}

function updateParseSummary() {
  const checked  = document.querySelectorAll('.parse-check:checked').length;
  const total    = parsedEvents.length;
  const weeks    = parseInt(document.getElementById('parse-repeat')?.value) || 1;
  const added    = checked * weeks;
  const summary  = document.getElementById('parse-summary');
  if (summary) summary.textContent = `${checked} of ${total} classes selected · ${weeks} week(s) · ${added} total events will be added`;
}

function applyParsedSchedule() {
  const weekStr = document.getElementById('parse-week-date').value;
  const weeks   = parseInt(document.getElementById('parse-repeat').value) || 1;
  if (!weekStr) { toast('Please choose a start date.'); return; }

  const monday = mondayOf(parseIso(weekStr));
  const DAY_OFF = { Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5, Sunday:6 };

  // Read which rows are checked + grab current category values from dropdowns
  const rows     = document.querySelectorAll('#parse-tbody tr');
  const selected = [];
  rows.forEach((row, i) => {
    if (!row.querySelector('.parse-check')?.checked) return;
    const ev = { ...parsedEvents[i] };
    selected.push(ev);
  });

  if (!selected.length) { toast('No classes selected.'); return; }

  const events = getEvents();
  let added = 0;

  for (let w = 0; w < weeks; w++) {
    const wMon = new Date(+monday + w * 7 * 86400000);
    selected.forEach(ev => {
      const off  = DAY_OFF[ev.day] ?? 0;
      const date = new Date(+wMon + off * 86400000);
      const notes = [ev.teacher, ev.room].filter(Boolean).join(' · ');
      events.push({
        id:       uid(),
        userId:   sessionUser.id,
        kidId:    activeKidId || null,
        title:    ev.subject,
        date:     isoDate(date),
        time:     ev.startTime  || '',
        endTime:  ev.endTime    || '',
        category: ev.category   || guessCategory(ev.subject),
        notes,
      });
      added++;
    });
  }

  saveEvents(events);
  loadFamilyEvents(); // push the new local events to the server (silent — no chat flood)
  closeModal('parse-modal');
  renderCalendar();
  renderMiniCal();
  toast(`✅ Added ${added} events to your calendar!`);
}

/* ============================================================
   MODALS
============================================================ */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function closeModalOnBg(e, id) {
  if (e.target.id === id) closeModal(id);
}

/* ============================================================
   CHAT
   Poll-based (GET /api/chat/messages?since=) rather than WebSocket for this
   scaffold — see lib/chat.js. Chat lives on the dashboard (Calendar tab),
   not a separate tab — polling runs while the dashboard is the active panel
   and stops the moment the user switches to another tab (Homework/Goals/
   Activities/Settings), so it doesn't poll needlessly in the background.
   Parent-only controls (delete/flag) are still backend-enforced
   (requireParent) — the UI just doesn't offer delete to a kid session.
============================================================ */
/* Horizon per-kid identity color: first kid in family order = teal, second =
   amber, any further kid = violet — per the redesign's design language (this
   replaces the arbitrary picker color from Settings > Add a kid profile for
   every accent use — chat bubbles, schedule bars, kid avatars — the picker
   color still seeds .kid-row-swatch in Manage Family, unrelated to this). */
function kidColorFor(kidProfileId) {
  const kids = (currentFamily && currentFamily.kids) || [];
  const idx = kids.findIndex((k) => k.id === kidProfileId);
  if (idx === 0) return 'var(--c-teal)';
  if (idx === 1) return 'var(--c-amber)';
  if (idx > 1) return 'var(--c-violet)';
  return null;
}

function chatSenderName(msg) {
  if (msg.senderType === 'kid') {
    const kids = (currentFamily && currentFamily.kids) || [];
    const k = kids.find((x) => x.id === msg.senderId);
    return k ? k.name : 'Kid';
  }
  if (currentFamily && currentFamily.parents) {
    const p = currentFamily.parents.find((x) => x.id === msg.senderId);
    if (p && p.name) return p.name;
  }
  if (sessionUser && msg.senderId === sessionUser.id) return sessionUser.name || 'You';
  return 'Parent';
}

function isOwnMessage(msg) {
  if (!sessionUser) return false;
  if (isKidSession()) return msg.senderType === 'kid' && msg.senderId === sessionUser.kidId;
  return msg.senderType === 'parent' && msg.senderId === sessionUser.id;
}

function renderChatCard(card) {
  if (!card || !card.type) return '';
  const icon = card.type === 'homework' ? '📚' : card.type === 'event' ? '📅' : '🔗';
  const label = card.type === 'homework' ? 'Homework' : card.type === 'event' ? 'Event' : esc(card.type);
  return `<div class="chat-msg-card">
    <span class="chat-card-icon">${icon}</span>
    <div class="chat-card-body">
      <div class="chat-card-label">${label}</div>
      ${card.title ? `<div class="chat-card-title">${esc(card.title)}</div>` : ''}
    </div>
  </div>`;
}

function scrollChatToBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}
// A chat GIF grows the list height AFTER render (it loads async). Re-scroll to
// the bottom on load, but only if the user is already near it — so we don't
// yank them away while they're scrolled up reading history.
function chatMediaMaybeScroll(img) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const imgH = (img && img.offsetHeight) || 0;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < imgH + 120) el.scrollTop = el.scrollHeight;
}

function renderChatMedia(media) {
  if (!media || media.type !== 'gif' || !media.previewUrl) return '';
  const full = media.url || media.previewUrl;
  return `<a href="${esc(full)}" target="_blank" rel="noopener noreferrer" class="chat-msg-gif-link">
    <img src="${esc(media.previewUrl)}" alt="GIF" class="chat-msg-gif" loading="lazy" onload="chatMediaMaybeScroll(this)">
  </a>`;
}

function renderChatMessages() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;

  el.innerHTML = chatMessages.map((m) => {
    if (m.deleted) {
      return `<div class="chat-msg chat-msg-deleted"><span class="chat-msg-deleted-text">Message deleted</span></div>`;
    }
    const own = isOwnMessage(m);
    const color = m.senderType === 'kid' ? (kidColorFor(m.senderId) || 'var(--accent)') : 'var(--accent)';
    const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const pinBtn = (!m.deleted && m.text) ? `<button class="chat-msg-ctrl" onclick="handlePinChatMessage('${m.id}')" title="Pin to notes">📌</button>` : '';
    const controls = !isKidSession() ? `
      <div class="chat-msg-controls">
        ${pinBtn}
        <button class="chat-msg-ctrl" onclick="handleDeleteChatMessage('${m.id}')" title="Delete message">🗑️</button>
        <button class="chat-msg-ctrl" onclick="handleFlagChatMessage('${m.id}')" title="Report / flag message">🚩</button>
      </div>` : `
      <div class="chat-msg-controls">
        ${pinBtn}
        <button class="chat-msg-ctrl" onclick="handleFlagChatMessage('${m.id}')" title="Report / flag message">🚩</button>
      </div>`;
    return `<div class="chat-msg ${own ? 'chat-msg-own' : 'chat-msg-other'}">
      ${!own ? `<div class="chat-msg-sender" style="color:${color}">${esc(chatSenderName(m))}</div>` : ''}
      <div class="chat-msg-bubble" style="${own ? '' : `--sender-color:${color}`}">
        ${m.text ? `<div class="chat-msg-text">${esc(m.text)}</div>` : ''}
        ${renderChatMedia(m.media)}
        ${renderChatCard(m.card)}
      </div>
      <div class="chat-msg-meta">
        <span class="chat-msg-time">${time}</span>
        ${controls}
      </div>
    </div>`;
  }).join('') || '<p class="text-muted chat-empty">No messages yet. Say hi! 👋</p>';

  if (wasAtBottom) el.scrollTop = el.scrollHeight;
  updateChatUnreadBadge();
}

async function loadChatMessages() {
  try {
    const msgs = await window.auth.getMessages();
    chatMessages = msgs;
    chatLastAt = msgs.length ? msgs[msgs.length - 1].createdAt : null;
    chatLastId = msgs.length ? msgs[msgs.length - 1].id : null;
    renderChatMessages();
    scrollChatToBottom(); // always land on the latest message when (re)loading
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

// Merge a batch of fetched messages into chatMessages by id: a poll can
// return an update to an already-seen message (e.g. deleted/flagged in
// place), not just brand-new ones.
function mergeChatMessages(msgs) {
  if (!msgs.length) return;
  const byId = new Map(chatMessages.map((m) => [m.id, m]));
  for (const m of msgs) byId.set(m.id, m);
  chatMessages = Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  chatLastAt = chatMessages[chatMessages.length - 1].createdAt;
  chatLastId = chatMessages[chatMessages.length - 1].id;
  renderChatMessages();
}

// One-shot immediate fetch (not long-polling) — used for the "just sent a
// message" fallback and by the realtime nudge. Callers that want to keep
// receiving new messages continuously should rely on the long-poll loop
// (startChatPolling), not repeated calls to this.
async function pollChatMessages() {
  try {
    mergeChatMessages(await window.auth.getMessages(chatLastAt));
  } catch (err) { /* transient poll failures shouldn't spam toasts */ }
}

// Long-poll loop: hold a GET open (server-side wait, up to CHAT_LONGPOLL_WAIT_S)
// until a new message exists, render it, and immediately re-request — this
// replaces the old fixed 2s setInterval with near-instant delivery and far
// fewer idle requests. Paused entirely while the tab is hidden.
async function chatLongPollFetch() {
  const qs = `?afterId=${encodeURIComponent(chatLastId || '')}&wait=1`;
  chatPollAbort = new AbortController();
  const res = await fetch('/api/chat/messages' + qs, { credentials: 'same-origin', signal: chatPollAbort.signal });
  if (!res.ok) throw new Error(`poll failed (${res.status})`);
  const data = await res.json().catch(() => null);
  return (data && data.messages) || [];
}

function chatWaitForVisible() {
  return new Promise((resolve) => {
    const onVis = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onVis);
      resolve();
    };
    document.addEventListener('visibilitychange', onVis);
  });
}

async function chatLongPollLoop() {
  let backoffIdx = 0;
  while (chatPollTimer) {
    if (document.hidden) { await chatWaitForVisible(); continue; }
    try {
      const msgs = await chatLongPollFetch();
      if (!chatPollTimer) break;
      mergeChatMessages(msgs);
      backoffIdx = 0;
    } catch (err) {
      if (!chatPollTimer || err.name === 'AbortError') continue; // stopped, or woken early on purpose — retry now, no backoff
      await new Promise((r) => setTimeout(r, CHAT_BACKOFF_MS[Math.min(backoffIdx, CHAT_BACKOFF_MS.length - 1)]));
      backoffIdx++;
    }
  }
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = true;
  chatLongPollLoop();
  setupChatRealtimeNudges();
}

function stopChatPolling() {
  chatPollTimer = false;
  if (chatPollAbort) { chatPollAbort.abort(); chatPollAbort = null; }
}

// Instant-refresh triggers so a new message renders with ~no lag instead of
// waiting out the long-poll: (a) the service worker posts 'fam-push' the
// moment a chat push arrives; (b) the tab regaining focus/visibility. Both
// abort the in-flight long-poll fetch so chatLongPollLoop immediately
// re-requests with the latest cursor, rather than waiting up to
// CHAT_LONGPOLL_WAIT_S. Registered once.
let chatNudgesReady = false;
function setupChatRealtimeNudges() {
  if (chatNudgesReady) return;
  chatNudgesReady = true;
  const nudge = () => { if (chatPollTimer && chatPollAbort) chatPollAbort.abort(); };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'fam-push') nudge();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nudge(); });
  window.addEventListener('focus', nudge);
}

/* ============================================================
   CHAT DOCK — avatar strip, collapse-to-slim-rail (Homework/Goals/
   Activities), unread badge, and the kid-session slide-over.
   Docked-vs-collapsed-vs-hidden per tab is decided in switchNavTab().
============================================================ */
function renderChatDockAvatars() {
  if (!currentFamily) return;
  const parents = currentFamily.parents || (currentFamily.parentIds || []).map((id) => ({ id, name: null }));
  const kids = currentFamily.kids || [];
  const items = parents.map((p) => ({
    initial: ((p.name || 'P')[0] || 'P').toUpperCase(),
    isMe: sessionUser && p.id === sessionUser.id,
    color: 'var(--accent)',
  })).concat(kids.map((k) => ({
    initial: (k.name || 'K')[0].toUpperCase(),
    isMe: sessionUser && k.id === sessionUser.kidId,
    color: kidColorFor(k.id) || 'var(--accent)',
  })));
  ['chat-dock-avatars'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.map((it) =>
      `<span class="chat-avatar-dot${it.isMe ? ' is-me' : ''}" style="${it.isMe ? '' : `background:${it.color}`}">${esc(it.initial)}</span>`
    ).join('');
  });
}

// fam_chat_seen_at: last time the dock was actually open/visible to this
// user — drives the unread badge shown while the dock is collapsed/hidden.
function chatSeenAtKey() { return `fam_chat_seen_at_${(sessionUser && sessionUser.id) || 'anon'}`; }
function markChatSeen() { save(chatSeenAtKey(), new Date().toISOString()); updateChatUnreadBadge(); }

function chatUnreadCount() {
  const seenAt = load(chatSeenAtKey()) || '';
  return chatMessages.filter((m) => !m.deleted && m.createdAt > seenAt && !isOwnMessage(m)).length;
}

function updateChatUnreadBadge() {
  const dock = document.getElementById('chat-dock');
  const dockVisible = dock && !dock.hidden && !dock.classList.contains('chat-collapsed');
  // Being looked at right now — nothing to badge. Compute count as 0 directly
  // rather than calling markChatSeen() here: markChatSeen() itself calls this
  // function, and re-entering it would recurse forever.
  const count = dockVisible ? 0 : chatUnreadCount();
  [['chat-unread-badge'], ['chat-fab-badge']].forEach(([id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count > 9 ? '9+' : String(count);
    el.hidden = count === 0;
  });
}

/* Homework/Goals/Activities: dock shrinks to a 56px avatar rail; clicking it
   force-expands over the content (doesn't change flow layout). Today/Calendar
   show it fully docked; Notes/Settings hide it — see applyChatDockState(). */
function handleChatDockClick(event) {
  const dock = document.getElementById('chat-dock');
  if (!dock || !dock.classList.contains('chat-collapsed')) return;
  if (dock.classList.contains('chat-force-open')) {
    // Only collapse back on a click outside the actual chat card (so typing
    // a message doesn't immediately re-collapse the dock).
    if (event.target.closest('.chat-card')) return;
    dock.classList.remove('chat-force-open');
  } else {
    dock.classList.add('chat-force-open');
    markChatSeen();
  }
}

function toggleKidChat() {
  const dock = document.getElementById('chat-dock');
  if (!dock) return;
  const open = dock.classList.toggle('chat-open');
  if (open) markChatSeen();
}

const CHAT_DOCK_MODE = { today: 'open', calendar: 'open', homework: 'collapsed', goals: 'collapsed', activities: 'collapsed', notes: 'hidden', settings: 'hidden' };
function applyChatDockState(tab) {
  const dock = document.getElementById('chat-dock');
  if (!dock) return;
  const mode = CHAT_DOCK_MODE[tab] || 'open';
  dock.hidden = mode === 'hidden';
  dock.classList.toggle('chat-collapsed', mode === 'collapsed');
  dock.classList.remove('chat-force-open');
  dock.classList.remove('chat-open'); // switching tabs closes any open slide-over
  // The FAB (kid sessions, and any session on narrow screens — see styles.css)
  // shouldn't appear at all when the dock itself is hidden (Notes/Settings).
  const fab = document.getElementById('chat-fab');
  if (fab) fab.hidden = mode === 'hidden';
  if (mode === 'open') markChatSeen(); else updateChatUnreadBadge();
}

/* ============================================================
   KID SIGN-IN REQUESTS (parent approval)
   A kid asked to join on their device; the family's parents see a banner here
   and Approve/Deny. Approving creates the kid profile and unlocks passkey setup
   on the kid's device. Parents-only; kids never poll or see this. Backed by
   /api/family/access-requests (see lib/kid-access.js).
============================================================ */
const KID_REQ_POLL_MS = 12000;
let kidReqPollTimer = null;
let kidNudgesReady = false;

async function renderKidAccessRequests() {
  const banner = document.getElementById('kid-requests-banner');
  if (!banner) return;
  if (isKidSession() || !currentFamily) { banner.hidden = true; banner.innerHTML = ''; return; }
  let reqs = [];
  try { reqs = await window.auth.getKidAccessRequests(); }
  catch (e) { return; } // transient — keep whatever's shown
  if (!reqs.length) { banner.hidden = true; banner.innerHTML = ''; return; }
  banner.innerHTML = reqs.map((r) => `
    <div class="kid-request-card">
      <div class="kid-request-info">
        <span class="kid-request-emoji">🙋</span>
        <div>
          <div class="kid-request-title"><strong>${esc(r.name)}</strong> wants to sign in</div>
          <div class="kid-request-sub">on ${esc(r.deviceLabel || 'a device')}</div>
        </div>
      </div>
      <div class="kid-request-actions">
        <button class="btn-primary kid-approve" onclick="handleApproveKid('${esc(r.id)}')">Approve</button>
        <button class="btn-secondary kid-deny" onclick="handleDenyKid('${esc(r.id)}')">Deny</button>
      </div>
    </div>`).join('');
  banner.hidden = false;
}

async function handleApproveKid(id) {
  try {
    const res = await window.auth.approveKidAccess(id);
    if (res && res.family) {
      currentFamily = res.family;
      save('fam_family', currentFamily);
      renderKidSwitcher();
    }
    toast('Approved! They can finish setting up on their device. ✅');
  } catch (err) { toast(`❌ ${err.message}`); }
  renderKidAccessRequests();
}

async function handleDenyKid(id) {
  try { await window.auth.denyKidAccess(id); toast('Request denied.'); }
  catch (err) { toast(`❌ ${err.message}`); }
  renderKidAccessRequests();
}

function startKidRequestPolling() {
  if (isKidSession()) return; // kids don't approve anyone
  stopKidRequestPolling();
  renderKidAccessRequests();
  kidReqPollTimer = setInterval(renderKidAccessRequests, KID_REQ_POLL_MS);
  setupKidRequestNudges();
}
function stopKidRequestPolling() {
  if (kidReqPollTimer) { clearInterval(kidReqPollTimer); kidReqPollTimer = null; }
}
// Instant refresh when a kid-access push lands or the tab regains focus, so a
// waiting kid isn't stuck on the 12s tick. Registered once.
function setupKidRequestNudges() {
  if (kidNudgesReady) return;
  kidNudgesReady = true;
  const nudge = () => { if (kidReqPollTimer) renderKidAccessRequests(); };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'fam-push') nudge();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nudge(); });
  window.addEventListener('focus', nudge);
}

async function handleSendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  try {
    const res = await window.auth.sendChatMessage(text);
    if (input) input.value = '';
    if (res && res.message) {
      chatMessages.push(res.message);
      chatLastAt = res.message.createdAt;
      renderChatMessages();
    } else {
      await pollChatMessages();
    }
    scrollChatToBottom(); // your own message: always jump to the bottom
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function handleDeleteChatMessage(id) {
  if (!confirm('Delete this message for the whole family?')) return;
  try {
    const res = await window.auth.deleteChatMessage(id);
    const idx = chatMessages.findIndex((m) => m.id === id);
    if (idx !== -1 && res && res.message) chatMessages[idx] = res.message;
    renderChatMessages();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function handleFlagChatMessage(id) {
  const reason = prompt('What\'s wrong with this message? (optional)') || '';
  try {
    await window.auth.flagChatMessage(id, reason);
    toast('Message reported. A parent will review it. 🚩');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ============================================================
   CHAT PICKERS — emoji popover (hardcoded unicode grid, no external lib)
   and GIF popover (Giphy, proxied through our server — see auth.js
   searchGifs/trendingGifs). Only one popover is open at a time.
============================================================ */
function closeChatPickers() {
  const emojiPop = document.getElementById('chat-emoji-popover');
  const gifPop = document.getElementById('chat-gif-popover');
  if (emojiPop) emojiPop.hidden = true;
  if (gifPop) gifPop.hidden = true;
  chatGifOpenToken++; // invalidate any in-flight GIF load/search for this open
}

function renderEmojiPopover() {
  const el = document.getElementById('chat-emoji-popover');
  if (!el) return;
  el.innerHTML = CHAT_EMOJI_LIST.map((e) =>
    `<button type="button" class="chat-emoji-item" onclick="insertChatEmoji('${e}')">${e}</button>`
  ).join('');
}

function toggleEmojiPicker() {
  const el = document.getElementById('chat-emoji-popover');
  if (!el) return;
  const wasHidden = el.hidden;
  closeChatPickers();
  if (wasHidden) {
    renderEmojiPopover();
    el.hidden = false;
  }
}

function insertChatEmoji(emoji) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  const caret = start + emoji.length;
  input.focus();
  input.setSelectionRange(caret, caret);
}

function toggleGifPicker() {
  const el = document.getElementById('chat-gif-popover');
  if (!el) return;
  const wasHidden = el.hidden;
  closeChatPickers();
  if (wasHidden) {
    el.hidden = false;
    const search = document.getElementById('chat-gif-search');
    if (search) search.value = '';
    loadTrendingGifsIntoPicker();
  }
}

function renderGifGrid(gifs, token) {
  if (token !== chatGifOpenToken) return; // a newer open/search superseded this one
  const grid = document.getElementById('chat-gif-grid');
  if (!grid) return;
  if (!gifs.length) {
    grid.innerHTML = '<p class="text-muted chat-gif-empty">No GIFs found.</p>';
    return;
  }
  grid.innerHTML = gifs.map((g) =>
    `<button type="button" class="chat-gif-thumb" onclick="handleSendGif('${g.url.replace(/'/g, "\\'")}','${g.previewUrl.replace(/'/g, "\\'")}',${g.width || 0},${g.height || 0})">
      <img src="${esc(g.previewUrl)}" alt="${esc(g.title || 'GIF')}" loading="lazy">
    </button>`
  ).join('');
}

async function loadTrendingGifsIntoPicker() {
  const token = ++chatGifOpenToken;
  const grid = document.getElementById('chat-gif-grid');
  if (grid) grid.innerHTML = '<p class="text-muted chat-gif-loading">Loading GIFs…</p>';
  try {
    const gifs = await window.auth.trendingGifs();
    renderGifGrid(gifs, token);
  } catch (err) {
    if (token !== chatGifOpenToken) return;
    if (grid) grid.innerHTML = '<p class="text-muted chat-gif-empty">GIFs unavailable</p>';
  }
}

function handleGifSearchInput() {
  const input = document.getElementById('chat-gif-search');
  const q = input ? input.value.trim() : '';
  if (chatGifSearchTimer) clearTimeout(chatGifSearchTimer);
  chatGifSearchTimer = setTimeout(async () => {
    const token = ++chatGifOpenToken;
    const grid = document.getElementById('chat-gif-grid');
    if (grid) grid.innerHTML = '<p class="text-muted chat-gif-loading">Loading GIFs…</p>';
    try {
      const gifs = q ? await window.auth.searchGifs(q) : await window.auth.trendingGifs();
      renderGifGrid(gifs, token);
    } catch (err) {
      if (token !== chatGifOpenToken) return;
      if (grid) grid.innerHTML = '<p class="text-muted chat-gif-empty">GIFs unavailable</p>';
    }
  }, 350);
}

async function handleSendGif(url, previewUrl, width, height) {
  closeChatPickers();
  try {
    const res = await window.auth.sendChatMessage('', { type: 'gif', url, previewUrl, width, height });
    if (res && res.message) {
      chatMessages.push(res.message);
      chatLastAt = res.message.createdAt;
      renderChatMessages();
    } else {
      await pollChatMessages();
    }
    scrollChatToBottom(); // your own GIF: always jump to the bottom
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

// Close popovers on an outside click (but not clicks on the toggle buttons
// themselves — they handle their own open/close via toggle*Picker above).
document.addEventListener('click', (e) => {
  const anchor = document.getElementById('chat-emoji-popover');
  const gifAnchor = document.getElementById('chat-gif-popover');
  if (!anchor && !gifAnchor) return;
  const emojiOpen = anchor && !anchor.hidden;
  const gifOpen = gifAnchor && !gifAnchor.hidden;
  if (!emojiOpen && !gifOpen) return;
  const withinPopover = e.target.closest('.chat-popover');
  const isToggleBtn = e.target.closest('#chat-emoji-btn, #chat-gif-btn');
  if (!withinPopover && !isToggleBtn) closeChatPickers();
});

/* ============================================================
   HOMEWORK HUB (Phase 3)
   Server-sourced (family/kid-scoped, see lib/homework.js) — never stored in
   localStorage. Grouped by due date (Overdue / Today / This week / Later),
   filtered by the kid switcher (activeKidId) + a subject dropdown. Kid
   sessions see + can complete only their own homework (also enforced
   server-side — see server.js /api/homework routes).
============================================================ */
let homeworkItems   = [];   // last-loaded list from GET /api/homework
let editingHomeworkId = null; // set when add-homework modal is in edit mode
let activeHomeworkId  = null; // currently open in the detail modal

async function loadHomework() {
  try {
    homeworkItems = await window.auth.getHomework(isKidSession() ? { kidId: sessionUser.kidId } : {});
  } catch (e) {
    homeworkItems = [];
  }
  if (typeof scheduleReminders === 'function') scheduleReminders();
  return homeworkItems;
}

/* Local (non-persisted) due-date grouping mirroring lib/homework.js
   groupByDueDate() — kept in sync deliberately; see tests/homework.test.js
   for the server-side source of truth this must match. */
function groupHomeworkByDueDate(items) {
  const today = isoDate(new Date());
  const weekEnd = isoDate(new Date(Date.now() + 7 * 86400000));
  const groups = { overdue: [], today: [], thisWeek: [], later: [] };
  items.forEach((item) => {
    if (!item.dueDate) { groups.later.push(item); return; }
    if (item.dueDate < today) groups.overdue.push(item);
    else if (item.dueDate === today) groups.today.push(item);
    else if (item.dueDate <= weekEnd) groups.thisWeek.push(item);
    else groups.later.push(item);
  });
  return groups;
}

function updateHomeworkBadge() {
  const badge = document.getElementById('sidebar-homework-badge');
  if (!badge) return;
  // Today (and the sidebar badge) show the whole family, unfiltered — the
  // kid switcher lives on the Calendar screen, not the sidebar/Today.
  const groups = groupHomeworkByDueDate(homeworkItems.filter((h) => h.status !== 'done'));
  const count = groups.overdue.length + groups.today.length;
  badge.textContent = count;
  badge.hidden = count === 0;
}

function homeworkSourceBadge(source) {
  if (source === 'school') return '<span class="hw-source-badge" title="Synced from school calendar">🎓</span>';
  if (source === 'ai') return '<span class="hw-source-badge" title="Added from a photo (AI parsed)">📸</span>';
  return '<span class="hw-source-badge" title="Added manually">✏️</span>';
}

function kidNameFor(kidId) {
  const kids = (currentFamily && currentFamily.kids) || [];
  const k = kids.find((x) => x.id === kidId);
  return k ? k.name : '';
}


function populateSubjectFilter() {
  const sel = document.getElementById('homework-subject-filter');
  if (!sel) return;
  const current = sel.value;
  const subjects = Array.from(new Set(homeworkItems.map((h) => h.subject).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">All subjects</option>' +
    subjects.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if (subjects.includes(current)) sel.value = current;
}

function renderHomeworkHub() {
  populateSubjectFilter();
  const list = document.getElementById('homework-list');
  if (!list) return;

  const subjectFilter = document.getElementById('homework-subject-filter')?.value || '';
  let items = homeworkItems.slice();
  if (activeKidId) items = items.filter((h) => h.kidId === activeKidId);
  if (subjectFilter) items = items.filter((h) => h.subject === subjectFilter);

  if (!items.length) {
    list.innerHTML = `<p class="text-muted">No homework yet. ${isKidSession() ? "Nice — you're all caught up! 🎉" : 'Add one, or sync your school calendars for automatic deadlines.'}</p>`;
    return;
  }

  // Overdue/Due today/This week/Later come from the shared groupHomeworkByDueDate
  // (pending items only — same bucketing Today's homework widget uses, see that
  // function's header comment). "Done this week" is computed separately here
  // rather than folded into groupHomeworkByDueDate, so completed items don't
  // also vanish from Today's due-list (out of scope for this pass).
  const groups = groupHomeworkByDueDate(items.filter((h) => h.status !== 'done'));
  const mondayIso = isoDate(mondayOf(new Date()));
  // ponytail: "done this week" uses updatedAt as a completion-time proxy (any
  // edit bumps it, not just the done toggle) — there's no separate completedAt
  // field. Good enough; revisit if stale edits make this noisy.
  const doneThisWeek = items.filter((h) => h.status === 'done' && (h.updatedAt || h.dueDate || '').slice(0, 10) >= mondayIso);

  const sections = [
    ['overdue', 'Overdue', groups.overdue],
    ['today', 'Due today', groups.today],
    ['thisWeek', 'This week', groups.thisWeek],
    ['later', 'Later', groups.later],
    ['done', 'Done this week', doneThisWeek],
  ].filter(([, , rows]) => rows.length);

  if (!sections.length) {
    list.innerHTML = `<p class="text-muted">${isKidSession() ? "Nothing due — you're all caught up! 🎉" : 'Nothing due right now.'}</p>`;
    return;
  }

  list.innerHTML = sections.map(([key, label, rows]) => `
    <div class="homework-group">
      <div class="homework-group-title micro-label homework-group-title-${key}">
        <span>${label}</span><span class="homework-group-count">${rows.length}</span>
      </div>
      <div class="homework-group-items">
        ${rows.slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(renderHomeworkRow).join('')}
      </div>
    </div>
  `).join('');
}

// "Plan a work session" from a homework row (canvas 1c's inline hint) — thin
// wrapper around the existing detail-modal action (planWorkSessionForCurrentHomework)
// so the row doesn't need its own copy of that logic.
function planWorkSessionFor(id) {
  activeHomeworkId = id;
  planWorkSessionForCurrentHomework();
}

function homeworkMetaLine(item) {
  const checklistTotal = (item.checklist || []).length;
  if (checklistTotal) {
    const done = item.checklist.filter((c) => c.done).length;
    return `${done} of ${checklistTotal} steps done`;
  }
  if (item.source === 'school') {
    const feed = item.subject ? esc(item.subject) : 'the school calendar';
    const effort = item.effortMin ? ` · ~${Math.max(1, Math.round(item.effortMin / 60))}h effort` : '';
    return `Synced from ${feed}${effort}`;
  }
  if (item.effortMin) return `~${item.effortMin} min effort`;
  if (isKidSession() || item.status === 'done') return '';
  return `<a href="#" class="hw-meta-link" onclick="event.stopPropagation();planWorkSessionFor('${item.id}');return false">Plan a work session → adds a calendar block</a>`;
}

function renderHomeworkRow(item) {
  const done = item.status === 'done';
  const today = isoDate(new Date());
  const overdue = !done && item.dueDate && item.dueDate < today;
  const isToday = !done && item.dueDate === today;
  const dueClass = overdue ? 'hw-due-overdue' : (isToday ? 'hw-due-today' : '');
  const dueText = item.dueDate ? (isToday ? 'Today' : esc(formatShort(parseIso(item.dueDate)))) : '';
  const kidColor = item.kidId ? kidColorFor(item.kidId) : null;
  const kidTag = (!isKidSession() && item.kidId) ? `
    <span class="hw-kid-tag" style="color:${kidColor || 'var(--text-2)'}">
      <span class="hw-kid-dot" style="background:${kidColor || 'var(--text-2)'}"></span>${esc(kidNameFor(item.kidId))}
    </span>` : '';

  return `
    <div class="homework-row${done ? ' hw-done' : ''}" data-hw-id="${item.id}">
      <button class="hw-check${done ? ' checked' : ''}${overdue ? ' hw-check-overdue' : ''}" onclick="event.stopPropagation();toggleHomeworkDone('${item.id}')" title="${done ? 'Mark as not done' : 'Mark as done'}" aria-label="Toggle done">${done ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}</button>
      <div class="hw-row-main" onclick="openHomeworkDetail('${item.id}')">
        <div class="hw-row-title-line">
          <span class="hw-row-title">${esc(item.title)}</span>
          ${homeworkSourceBadge(item.source)}
        </div>
        <div class="hw-row-sub">${homeworkMetaLine(item)}</div>
      </div>
      ${item.subject ? `<span class="hw-chip hw-subject-chip">${esc(item.subject)}</span>` : ''}
      ${kidTag}
      <span class="hw-due-label ${dueClass}">${dueText}</span>
    </div>`;
}

async function toggleHomeworkDone(id) {
  const item = homeworkItems.find((h) => h.id === id);
  if (!item) return;
  const nextStatus = item.status === 'done' ? 'todo' : 'done';
  try {
    const res = await window.auth.updateHomework(id, { status: nextStatus });
    const idx = homeworkItems.findIndex((h) => h.id === id);
    if (idx >= 0) homeworkItems[idx] = res.homework;
    renderHomeworkHub();
    scheduleReminders();
    if (nextStatus === 'done') {
      toast('Nice work! ✅');
      if (isKidSession()) celebrateHomeworkDone();
    }
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ============================================================
   TODAY SCREEN (the new landing view — canvas 1a/1f/1g)
   Merges real data only: today's schedule (visibleEvents), homework due
   (homeworkItems), and real homework-completion-this-week for the design's
   one required gradient "momentum" element. Habits/goals have no data model
   yet (Goals tab is an unbuilt placeholder) — that card renders an honest
   empty state instead of invented numbers. The Daily 5 card below reuses
   the existing quote/word/quiz/news widgets verbatim (see index.html).
============================================================ */
function renderTodayScreen() {
  if (!sessionUser) return;
  const now = new Date();
  const todayIso = isoDate(now);

  const dateLabel = document.getElementById('today-date-label');
  if (dateLabel) dateLabel.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const greetingEl = document.getElementById('today-greeting');
  if (greetingEl) {
    const firstName = (sessionUser.name || '').split(' ')[0] || 'there';
    const hour = now.getHours();
    const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    greetingEl.textContent = `${salutation}, ${firstName}`;
  }

  // Kids get the same Today affordances as parents — they can add events
  // (family or their own) now, so the Add-event button and sync status show
  // for everyone. Feed syncing itself is still parent-gated server-side.
  const syncStatusEl = document.getElementById('today-sync-status');
  const addEventBtn = document.getElementById('today-add-event-btn');
  if (addEventBtn) addEventBtn.style.display = '';
  if (syncStatusEl) {
    syncStatusEl.hidden = false;
    const textEl = document.getElementById('today-sync-text');
    if (textEl) {
      textEl.textContent = (schoolFeedsInfo && schoolFeedsInfo.lastSyncAt)
        ? `School feeds synced ${timeAgo(schoolFeedsInfo.lastSyncAt)}`
        : 'School feeds not synced yet';
    }
  }

  renderTodaySchedule(todayIso);
  renderTodayHomework(todayIso);
  renderTodayHabitsAndMomentum();
}

function renderTodayScheduleRow(ev) {
  const color = ev.kidId ? (kidColorFor(ev.kidId) || 'var(--c-violet)') : 'var(--c-violet)';
  const kidName = ev.kidId ? esc(kidNameFor(ev.kidId)) : '';
  const lock = ev.source === 'school' ? ' 🔒' : '';
  const meta = ev.location || ev.notes || '';
  return `<div class="schedule-row" onclick="showDetail('${ev.id}','${ev.occurrenceDate || ev.date}')">
    <span class="schedule-time">${ev.time ? esc(ev.time) : 'All day'}</span>
    <span class="schedule-bar" style="background:${color}"></span>
    <span class="schedule-main">
      <div class="schedule-title">${ev.recurring ? '<span class="evt-repeat-badge">↻</span>' : ''}${esc(ev.title)}${lock}</div>
      ${meta ? `<div class="schedule-meta">${esc(meta)}</div>` : ''}
    </span>
    ${kidName ? `<span class="schedule-kid" style="color:${color}">${kidName}</span>` : ''}
  </div>`;
}

// An event is "today" if today falls anywhere in its date..endDate span.
function eventsOnDay(events, ds) {
  return events.filter((e) => e.date <= ds && (e.endDate || e.date) >= ds);
}

function renderTodaySchedule(todayIso) {
  const listEl = document.getElementById('today-schedule-list');
  const countEl = document.getElementById('today-schedule-count');
  const tomorrowWrap = document.getElementById('today-tomorrow');
  const tomorrowRow = document.getElementById('today-tomorrow-row');
  if (!listEl) return;

  // Today shows the whole family merged. A kid sees family (unscoped) events
  // plus their own — never a sibling's — matching the calendar visibility
  // model (see visibleEvents).
  const events = allEvents()
    .filter((e) => !isKidSession() || e.kidId == null || e.kidId === sessionUser.kidId);
  const todays = eventsOnDay(events, todayIso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const addEventHint = ' — <a href="#" class="btn-link" style="display:inline" onclick="openAddEventModal();return false">add one</a>';
  if (countEl) countEl.textContent = todays.length ? `${todays.length} event${todays.length === 1 ? '' : 's'}` : '';
  listEl.innerHTML = todays.length
    ? todays.map(renderTodayScheduleRow).join('')
    : `<div class="today-empty">Nothing on the calendar today${addEventHint}.</div>`;

  const tomorrowIso = isoDate(new Date(Date.now() + 86400000));
  const tomorrowEvents = eventsOnDay(events, tomorrowIso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  if (tomorrowWrap) tomorrowWrap.hidden = !tomorrowEvents.length;
  if (tomorrowRow && tomorrowEvents.length) {
    const first = tomorrowEvents[0];
    const more = tomorrowEvents.length > 1 ? ` +${tomorrowEvents.length - 1} more` : '';
    tomorrowRow.innerHTML = `<span class="schedule-time">${first.time ? esc(first.time) : 'All day'}</span><span>${esc(first.title)}${esc(more)}</span>`;
  }
}

function renderTodayHomeworkRow(item, todayIso) {
  const done = item.status === 'done';
  const overdue = !done && item.dueDate && item.dueDate < todayIso;
  const isToday = !done && item.dueDate === todayIso;
  let when = '';
  if (overdue) when = isKidSession() ? 'catch up!' : 'overdue';
  else if (isToday) when = 'today';
  else if (item.dueDate) when = parseIso(item.dueDate).toLocaleDateString('en-US', { weekday: 'short' });
  const whenClass = overdue ? 'overdue' : (isToday ? 'today' : '');
  const dotColor = item.kidId ? (kidColorFor(item.kidId) || 'var(--c-violet)') : 'var(--c-violet)';
  const checkCls = done ? 'done' : (overdue ? 'overdue' : '');
  const checkMark = done
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : '';
  return `<div class="homework-due-row${done ? ' done' : ''}" onclick="event.stopPropagation();toggleHomeworkDone('${item.id}')">
    <button type="button" class="homework-due-check ${checkCls}" aria-label="Toggle done">${checkMark}</button>
    <span class="homework-due-title">${esc(item.title)}</span>
    ${when ? `<span class="homework-due-when ${whenClass}">${esc(when)}</span>` : ''}
    <span class="homework-due-kid-dot" style="background:${dotColor}"></span>
  </div>`;
}

function renderTodayHomework(todayIso) {
  const listEl = document.getElementById('today-homework-list');
  if (!listEl) return;

  const groups = groupHomeworkByDueDate(homeworkItems);
  const rows = groups.overdue.concat(groups.today, groups.thisWeek)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 6);

  if (!rows.length) {
    listEl.innerHTML = `<div class="today-empty">No homework due this week 🎉</div>`;
    return;
  }
  listEl.innerHTML = rows.map((item) => renderTodayHomeworkRow(item, todayIso)).join('');
}

function renderTodayHabitRow(goal) {
  const checkedToday = (goal.checks || []).includes(isoDate(new Date()));
  const color = kidColorFor(goal.kidId) || 'var(--accent)';
  const streak = goalCurrentStreak(goal);
  return `<div class="habit-row">
    <button type="button" class="habit-check${checkedToday ? ' done' : ''}" onclick="toggleGoalCheckIn('${goal.id}')" aria-label="Check in" title="${checkedToday ? 'Checked in — tap to undo' : 'Check in for today'}"></button>
    <span class="habit-title">${esc(goal.title)}</span>
    <span class="habit-streak" style="color:${streak > 0 ? 'var(--coral)' : 'var(--text-2)'}">${streak > 0 ? streak + 'd' : ''}</span>
  </div>`;
}

function renderTodayHabitsAndMomentum() {
  const listEl = document.getElementById('today-habits-list');
  const countEl = document.getElementById('today-habits-count');
  const habitGoals = goalsItems.filter((g) => g.type === 'habit' && (!isKidSession() || g.kidId === sessionUser.kidId));

  if (listEl) {
    if (!habitGoals.length) {
      listEl.innerHTML = `<p class="today-empty-cta">Set a first goal — reading, practice, anything worth a streak. <a href="#" onclick="switchNavTab('goals');return false">Add one →</a></p>`;
    } else {
      listEl.innerHTML = habitGoals.map(renderTodayHabitRow).join('');
    }
  }
  const todayIso = isoDate(new Date());
  const checkedTodayCount = habitGoals.filter((g) => (g.checks || []).includes(todayIso)).length;
  if (countEl) countEl.textContent = habitGoals.length ? `${checkedTodayCount}/${habitGoals.length}` : '';

  // The design reserves exactly one coral→violet gradient "momentum" element
  // per screen, tied to habit completion — now wired to real weekly check-ins
  // across every habit goal.
  const labelEl = document.getElementById('today-momentum-label');
  const valueEl = document.getElementById('today-momentum-value');
  const fillEl = document.getElementById('today-momentum-fill');
  const totalTarget = habitGoals.reduce((sum, g) => sum + (g.target || 0), 0);
  const totalChecked = habitGoals.reduce((sum, g) => sum + goalChecksThisWeek(g), 0);
  if (labelEl) labelEl.textContent = 'Habit check-ins this week';
  if (valueEl) valueEl.textContent = totalTarget ? `${totalChecked}/${totalTarget}` : '—';
  if (fillEl) fillEl.style.width = totalTarget ? `${Math.min(100, Math.round((totalChecked / totalTarget) * 100))}%` : '0%';
}

/* News: quiet single line by default (the design's "news ticker"); the
   headline itself is a real link to the article (opens in a new tab) —
   click the separate chevron to expand the summary + reflection composer. */
function toggleNewsDetails() {
  const details = document.getElementById('news-details');
  if (details) details.classList.toggle('news-open');
}

/* ---------- Add / Edit homework ---------- */
let homeworkChecklistDraft = []; // [{text, done}] while the add/edit modal is open

function openAddHomeworkModal(prefill) {
  editingHomeworkId = null;
  homeworkChecklistDraft = [];
  document.getElementById('add-homework-title').textContent = '📚 Add homework';
  document.getElementById('homework-title').value = (prefill && prefill.title) || '';
  document.getElementById('homework-subject').value = (prefill && prefill.subject) || '';
  document.getElementById('homework-effort').value = '';
  document.getElementById('homework-due-date').value = (prefill && prefill.dueDate) || isoDate(new Date());
  document.getElementById('homework-due-time').value = '';
  document.getElementById('homework-notes').value = '';
  document.getElementById('homework-form-error').textContent = '';
  renderHomeworkChecklistEditor();

  const kidGroup = document.getElementById('homework-kid-group');
  const kidSelect = document.getElementById('homework-kid');
  if (isKidSession()) {
    kidGroup.style.display = 'none';
  } else {
    kidGroup.style.display = '';
    const kids = (currentFamily && currentFamily.kids) || [];
    kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">Add a kid first</option>';
    if (activeKidId) kidSelect.value = activeKidId;
  }
  openModal('add-homework-modal');
}

function editCurrentHomework() {
  const item = homeworkItems.find((h) => h.id === activeHomeworkId);
  if (!item) return;
  editingHomeworkId = item.id;
  homeworkChecklistDraft = (item.checklist || []).map((c) => Object.assign({}, c));
  document.getElementById('add-homework-title').textContent = '✏️ Edit homework';
  document.getElementById('homework-title').value = item.title;
  document.getElementById('homework-subject').value = item.subject || '';
  document.getElementById('homework-effort').value = item.effortMin || '';
  document.getElementById('homework-due-date').value = item.dueDate;
  document.getElementById('homework-due-time').value = item.dueTime || '';
  document.getElementById('homework-notes').value = item.notes || '';
  document.getElementById('homework-form-error').textContent = '';
  renderHomeworkChecklistEditor();

  const kidGroup = document.getElementById('homework-kid-group');
  if (isKidSession()) {
    kidGroup.style.display = 'none';
  } else {
    kidGroup.style.display = '';
    const kids = (currentFamily && currentFamily.kids) || [];
    document.getElementById('homework-kid').innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
    document.getElementById('homework-kid').value = item.kidId;
  }
  closeModal('homework-detail-modal');
  openModal('add-homework-modal');
}

function renderHomeworkChecklistEditor() {
  const el = document.getElementById('homework-checklist-editor');
  if (!el) return;
  el.innerHTML = homeworkChecklistDraft.map((c, i) => `
    <div class="homework-checklist-row">
      <input type="checkbox" ${c.done ? 'checked' : ''} onchange="homeworkChecklistDraft[${i}].done=this.checked">
      <input type="text" value="${esc(c.text)}" placeholder="Sub-step…" oninput="homeworkChecklistDraft[${i}].text=this.value">
      <button type="button" class="hw-checklist-remove" onclick="removeHomeworkChecklistRow(${i})" aria-label="Remove step">×</button>
    </div>`).join('');
}

function addHomeworkChecklistRow() {
  homeworkChecklistDraft.push({ text: '', done: false });
  renderHomeworkChecklistEditor();
}

function removeHomeworkChecklistRow(i) {
  homeworkChecklistDraft.splice(i, 1);
  renderHomeworkChecklistEditor();
}

async function saveHomeworkForm(e) {
  e.preventDefault();
  const errEl = document.getElementById('homework-form-error');
  const title = document.getElementById('homework-title').value.trim();
  const subject = document.getElementById('homework-subject').value.trim();
  const effortMin = document.getElementById('homework-effort').value;
  const dueDate = document.getElementById('homework-due-date').value;
  const dueTime = document.getElementById('homework-due-time').value;
  const notes = document.getElementById('homework-notes').value.trim();
  const checklist = homeworkChecklistDraft.filter((c) => c.text.trim());
  const kidId = isKidSession() ? sessionUser.kidId : document.getElementById('homework-kid').value;

  if (!isKidSession() && !kidId) { errEl.textContent = 'Add a kid profile first.'; return; }

  try {
    if (editingHomeworkId) {
      const res = await window.auth.updateHomework(editingHomeworkId, { title, subject, dueDate, dueTime, effortMin, notes, checklist });
      const idx = homeworkItems.findIndex((h) => h.id === editingHomeworkId);
      if (idx >= 0) homeworkItems[idx] = res.homework;
      toast('Homework updated 📚');
    } else {
      const res = await window.auth.addHomework({ kidId, title, subject, dueDate, dueTime, effortMin, notes, checklist });
      homeworkItems.push(res.homework);
      toast('Homework added 📚');
    }
    closeModal('add-homework-modal');
    renderHomeworkHub();
    renderCalendar();
    scheduleReminders();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* ---------- Detail / delete ---------- */
function openHomeworkDetail(id) {
  const item = homeworkItems.find((h) => h.id === id);
  if (!item) return;
  activeHomeworkId = id;

  const badge = document.getElementById('hw-detail-badge');
  badge.innerHTML = homeworkSourceBadge(item.source) + ' ' + (item.subject ? esc(item.subject) : 'Homework');
  badge.className = `detail-category-badge hw-status-${item.status}`;

  document.getElementById('hw-detail-title').textContent = item.title;
  document.getElementById('hw-detail-due').textContent = `${formatLong(parseIso(item.dueDate))}${item.dueTime ? ' · ' + fmt12(item.dueTime) : ''}`;

  const effortRow = document.getElementById('hw-detail-effort-row');
  if (item.effortMin) {
    document.getElementById('hw-detail-effort').textContent = `~${item.effortMin} min`;
    effortRow.style.display = '';
  } else {
    effortRow.style.display = 'none';
  }

  const notesRow = document.getElementById('hw-detail-notes-row');
  if (item.notes) {
    document.getElementById('hw-detail-notes').textContent = item.notes;
    notesRow.style.display = '';
  } else {
    notesRow.style.display = 'none';
  }

  const checklistEl = document.getElementById('hw-detail-checklist');
  if (item.checklist && item.checklist.length) {
    checklistEl.innerHTML = item.checklist.map((c, i) => `
      <label class="hw-checklist-view-row">
        <input type="checkbox" ${c.done ? 'checked' : ''} onchange="toggleHomeworkChecklistItem('${item.id}',${i},this.checked)">
        <span${c.done ? ' style="text-decoration:line-through;opacity:.6"' : ''}>${esc(c.text)}</span>
      </label>`).join('');
  } else {
    checklistEl.innerHTML = '';
  }

  // Kids can edit/delete only their OWN homework (also enforced server-side).
  const canManage = !isKidSession() || item.kidId === sessionUser.kidId;
  document.getElementById('hw-detail-edit-btn').style.display = canManage ? '' : 'none';
  document.getElementById('hw-detail-delete-btn').style.display = canManage ? '' : 'none';
  document.getElementById('hw-detail-plan-btn').style.display = isKidSession() ? 'none' : '';

  openModal('homework-detail-modal');
}

async function toggleHomeworkChecklistItem(id, index, done) {
  try {
    const res = await window.auth.updateHomework(id, {
      checklist: (homeworkItems.find((h) => h.id === id).checklist || []).map((c, i) => i === index ? { text: c.text, done } : c),
    });
    const idx = homeworkItems.findIndex((h) => h.id === id);
    if (idx >= 0) homeworkItems[idx] = res.homework;
    renderHomeworkHub();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function deleteCurrentHomework() {
  if (!activeHomeworkId) return;
  try {
    await window.auth.deleteHomework(activeHomeworkId);
    homeworkItems = homeworkItems.filter((h) => h.id !== activeHomeworkId);
    closeModal('homework-detail-modal');
    renderHomeworkHub();
    renderCalendar();
    toast('Homework removed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* "Plan a work session" — creates a linked manual calendar event (existing
   localStorage event model) before the due date. Parent-only affordance. */
function planWorkSessionForCurrentHomework() {
  const item = homeworkItems.find((h) => h.id === activeHomeworkId);
  if (!item) return;
  closeModal('homework-detail-modal');
  const dayBefore = new Date(+parseIso(item.dueDate) - 86400000);
  openAddEventModal(isoDate(dayBefore));
  // Pre-fill the add-event form with a helpful title; user picks time/category.
  const titleEl = document.getElementById('event-title');
  if (titleEl) titleEl.value = `Work session: ${item.title}`;
  const notesEl = document.getElementById('event-notes');
  if (notesEl) notesEl.value = `Linked to homework: ${item.title} (due ${item.dueDate})`;
}

/* ---------- Celebration animation (kid completions) ----------
   Lightweight CSS/JS confetti burst — no libraries. Draws a short-lived
   particle burst on the #confetti-canvas overlay, then clears itself. */
function celebrateHomeworkDone() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('show');

  const colors = ['#6C63FF', '#FF6B9D', '#4ECDC4', '#FFB84C', '#5AC8FA'];
  const particles = Array.from({ length: 80 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 120,
    y: canvas.height * 0.3,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 10 - 4,
    size: Math.random() * 8 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * 360,
    vr: (Math.random() - 0.5) * 20,
  }));

  const gravity = 0.35;
  let frame = 0;
  const maxFrames = 90;

  function step() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / maxFrames);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    if (frame < maxFrames) {
      requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('show');
    }
  }
  requestAnimationFrame(step);
}

/* ============================================================
   GOALS (Phase W3, canvas 1d) — habit rings (check in today, per-week
   target) + milestone bars (total count). Gentle language throughout: a
   missed day is never flagged, streaks just start counting again.
============================================================ */
let goalsItems = []; // last-loaded list from GET /api/goals

async function loadGoals() {
  try { goalsItems = await window.auth.getGoals({}); } catch (e) { goalsItems = []; }
  return goalsItems;
}

function goalChecksThisWeek(goal) {
  if (!goal || goal.type !== 'habit') return 0;
  const monday = mondayOf(new Date());
  const sunday = new Date(+monday + 6 * 86400000);
  const mondayIso = isoDate(monday), sundayIso = isoDate(sunday);
  return (goal.checks || []).filter((d) => d >= mondayIso && d <= sundayIso).length;
}

function goalCurrentStreak(goal) {
  if (!goal || goal.type !== 'habit') return 0;
  const set = new Set(goal.checks || []);
  let streak = 0;
  let d = new Date();
  while (set.has(isoDate(d))) { streak++; d = new Date(+d - 86400000); }
  return streak;
}

function goalRingSvg(goal) {
  const r = 26, c = 2 * Math.PI * r;
  const weekChecks = goalChecksThisWeek(goal);
  const frac = Math.min(1, goal.target ? weekChecks / goal.target : 0);
  const dash = (frac * c).toFixed(1);
  const color = kidColorFor(goal.kidId) || 'var(--accent)';
  const checkedToday = (goal.checks || []).includes(isoDate(new Date()));
  return `<button type="button" class="goal-ring-btn" onclick="toggleGoalCheckIn('${goal.id}')" title="${checkedToday ? 'Checked in today — tap to undo' : 'Check in for today'}" aria-label="Check in">
    <svg viewBox="0 0 66 66" width="66" height="66">
      <circle class="goal-ring-track" cx="33" cy="33" r="${r}"></circle>
      <circle class="goal-ring-fill" cx="33" cy="33" r="${r}" style="stroke:${color};stroke-dasharray:${dash} ${c.toFixed(1)}"></circle>
      <text x="33" y="38" class="goal-ring-text">${esc(String(weekChecks))}/${esc(String(goal.target))}</text>
    </svg>
  </button>`;
}

function renderGoalCard(goal) {
  const kidName = kidNameFor(goal.kidId);
  const canManage = !isKidSession();
  const deleteBtn = canManage
    ? `<button type="button" class="btn-link-danger goal-card-delete" onclick="deleteGoalItem('${goal.id}')" title="Delete goal">🗑️</button>` : '';

  if (goal.type === 'habit') {
    const streak = goalCurrentStreak(goal);
    const streakHtml = streak > 0
      ? `<div class="goal-card-streak"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c1 3-3 4.5-3 8a3.5 3.5 0 0 0 7 0c0-1.5-.7-2.6-1.5-3.5.2 1-.3 2-1.5 2.5.6-2-1-4.5-1-7z"></path></svg>${streak}-day streak</div>`
      : `<div class="goal-card-fresh">Fresh start today ✓</div>`;
    return `<div class="card goal-card" data-goal-id="${goal.id}">
      ${goalRingSvg(goal)}
      <div class="goal-card-body">
        <div class="goal-card-title">${esc(goal.title)}</div>
        <div class="goal-card-sub">${esc(kidName)} · habit</div>
        ${streakHtml}
      </div>
      ${deleteBtn}
    </div>`;
  }

  // milestone
  const pct = Math.min(100, goal.target ? Math.round((goal.progress / goal.target) * 100) : 0);
  const reached = goal.progress >= goal.target;
  return `<div class="card goal-card goal-card-milestone" data-goal-id="${goal.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div class="goal-card-title">${esc(goal.title)}</div>
        <div class="goal-card-sub">${esc(kidName)} · milestone</div>
      </div>
      ${deleteBtn}
    </div>
    <div class="goal-progress-row"><span class="micro-label">Progress</span><span class="goal-progress-count">${goal.progress}/${goal.target}</span></div>
    <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
    <button type="button" class="btn-secondary goal-increment-btn" onclick="incrementGoalMilestone('${goal.id}')"${reached ? ' disabled' : ''}>${reached ? 'Reached 🎉' : '+1'}</button>
  </div>`;
}

function renderGoalsRecap(habitGoals) {
  const card = document.getElementById('goals-recap-card');
  const rowsEl = document.getElementById('goals-recap-rows');
  const weekEl = document.getElementById('goals-recap-week');
  if (!card || !rowsEl) return;
  if (!habitGoals.length) { card.hidden = true; return; }
  card.hidden = false;
  if (weekEl) weekEl.textContent = `Family recap · week of ${formatShort(mondayOf(new Date()))}`;
  rowsEl.innerHTML = habitGoals.map((g) => {
    const color = kidColorFor(g.kidId) || 'var(--accent)';
    const checked = goalChecksThisWeek(g);
    const pct = Math.min(100, g.target ? Math.round((checked / g.target) * 100) : 0);
    return `<div class="goals-recap-row">
      <span class="goals-recap-kid" style="color:${color}"><span class="goals-recap-dot" style="background:${color}"></span>${esc(kidNameFor(g.kidId))}</span>
      <div class="goals-recap-track"><div class="goals-recap-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="goals-recap-count">${checked}/${g.target} ${esc(g.title)}</span>
    </div>`;
  }).join('');
}

function renderGoalsHub() {
  const listEl = document.getElementById('goals-list');
  if (!listEl) return;
  let items = goalsItems.slice();
  if (isKidSession()) items = items.filter((g) => g.kidId === sessionUser.kidId);

  if (!items.length) {
    const cta = isKidSession() ? '' : ` <a href="#" onclick="openAddGoalModal();return false">+ New goal</a>`;
    listEl.innerHTML = `<p class="goals-empty">Set a first goal — reading, practice, anything worth a streak.${cta}</p>`;
  } else {
    listEl.innerHTML = items.map(renderGoalCard).join('');
  }
  renderGoalsRecap(items.filter((g) => g.type === 'habit'));
}

function openAddGoalModal() {
  document.getElementById('goal-title').value = '';
  document.getElementById('goal-target').value = '';
  document.getElementById('goal-form-error').textContent = '';
  document.querySelector('input[name="goal-type"][value="habit"]').checked = true;
  updateGoalTargetLabel();

  const kids = (currentFamily && currentFamily.kids) || [];
  const kidSelect = document.getElementById('goal-kid');
  kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">Add a kid first</option>';
  if (isKidSession()) kidSelect.value = sessionUser.kidId;
  else if (activeKidId) kidSelect.value = activeKidId;
  openModal('add-goal-modal');
}

function updateGoalTargetLabel() {
  const checked = document.querySelector('input[name="goal-type"]:checked');
  const type = checked ? checked.value : 'habit';
  const label = document.getElementById('goal-target-label');
  const input = document.getElementById('goal-target');
  if (type === 'habit') { label.textContent = 'Times per week'; input.placeholder = '7'; }
  else { label.textContent = 'Target total'; input.placeholder = '50'; }
}

async function saveGoalForm(e) {
  e.preventDefault();
  const errEl = document.getElementById('goal-form-error');
  const kidId = isKidSession() ? sessionUser.kidId : document.getElementById('goal-kid').value;
  const title = document.getElementById('goal-title').value.trim();
  const type = document.querySelector('input[name="goal-type"]:checked').value;
  const target = document.getElementById('goal-target').value;
  if (!kidId) { errEl.textContent = 'Add a kid profile first.'; return; }
  try {
    const res = await window.auth.addGoal({ kidId, title, type, target });
    goalsItems.push(res.goal);
    closeModal('add-goal-modal');
    renderGoalsHub();
    renderTodayHabitsAndMomentum();
    toast('Goal added 🎯');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function toggleGoalCheckIn(id) {
  try {
    const res = await window.auth.checkGoalToday(id);
    const idx = goalsItems.findIndex((g) => g.id === id);
    if (idx >= 0) goalsItems[idx] = res.goal;
    renderGoalsHub();
    renderTodayHabitsAndMomentum();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function incrementGoalMilestone(id) {
  try {
    const res = await window.auth.incrementGoalProgress(id, 1);
    const idx = goalsItems.findIndex((g) => g.id === id);
    if (idx >= 0) goalsItems[idx] = res.goal;
    renderGoalsHub();
    if (res.goal.progress >= res.goal.target) toast('🎉 Milestone reached!');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function deleteGoalItem(id) {
  if (!confirm('Delete this goal?')) return;
  try {
    await window.auth.deleteGoal(id);
    goalsItems = goalsItems.filter((g) => g.id !== id);
    renderGoalsHub();
    renderTodayHabitsAndMomentum();
    toast('Goal deleted.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ============================================================
   ACTIVITIES (Phase W3, canvas 1e) — extracurricular registry + a day-of
   helper banner rendered only from real data (today's activity + its gear
   tags). Creating/editing an activity does NOT create calendar events in
   this phase — that sync is a follow-up.
============================================================ */
let activitiesItems = []; // last-loaded list from GET /api/activities
let editingActivityId = null;
let activityScheduleDraft = []; // [{day,start,end}] while the add/edit modal is open

async function loadActivities() {
  try { activitiesItems = await window.auth.getActivities({}); } catch (e) { activitiesItems = []; }
  return activitiesItems;
}

const ACTIVITY_DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ACTIVITY_CATEGORY_LABEL = { sports: 'Sports', arts: 'Arts', music: 'Music', other: 'Other' };

function formatActivitySchedule(schedule) {
  return (schedule || [])
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => `${ACTIVITY_DAY_LABEL[s.day] || s.day} ${fmt12(s.start)}${s.end ? '–' + fmt12(s.end) : ''}`)
    .join(', ');
}

function renderActivityCard(item) {
  const color = kidColorFor(item.kidId) || 'var(--accent)';
  const canManage = !isKidSession();
  const gearHtml = (item.gear || []).map((g) => `<span class="activity-gear-chip">${esc(g)}</span>`).join('');
  const manageLinks = canManage
    ? `<span><a href="#" class="btn-link activity-card-edit" onclick="editActivityItem('${item.id}');return false">Edit</a> · <a href="#" class="btn-link-danger" onclick="deleteActivityItem('${item.id}');return false">Delete</a></span>`
    : '';
  return `<div class="card activity-card" style="--kid-color:${color}" data-activity-id="${item.id}">
    <div class="activity-card-head">
      <div class="activity-card-name">${esc(item.name)}</div>
      <span class="micro-label">${ACTIVITY_CATEGORY_LABEL[item.category] || 'Other'}</span>
    </div>
    <div class="activity-card-kid">${esc(kidNameFor(item.kidId))}</div>
    <div class="activity-card-rows">
      ${item.schedule && item.schedule.length ? `<div class="activity-card-row"><span class="activity-card-row-label">When</span>${esc(formatActivitySchedule(item.schedule))}</div>` : ''}
      ${item.location ? `<div class="activity-card-row"><span class="activity-card-row-label">Where</span>${esc(item.location)}</div>` : ''}
      ${item.coachName ? `<div class="activity-card-row"><span class="activity-card-row-label">${esc(item.coachLabel || 'Coach')}</span>${esc(item.coachName)}</div>` : ''}
    </div>
    ${gearHtml ? `<div class="activity-gear-row">${gearHtml}</div>` : ''}
    ${(item.note || manageLinks) ? `<div class="activity-card-footer"><span>${esc(item.note || '')}</span>${manageLinks}</div>` : ''}
  </div>`;
}

function renderActivitiesDayOfBanner(items) {
  const el = document.getElementById('activities-dayof-banner');
  if (!el) return;
  const dowMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dow = dowMap[new Date().getDay()];
  const todays = [];
  items.forEach((a) => {
    const slot = (a.schedule || []).filter((s) => s.day === dow).sort((x, y) => x.start.localeCompare(y.start))[0];
    if (slot) todays.push({ activity: a, slot });
  });
  todays.sort((x, y) => x.slot.start.localeCompare(y.slot.start));

  if (!todays.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = todays.map(({ activity, slot }) => {
    const gear = (activity.gear || []).join(', ');
    return `<div class="activities-dayof-row">
      <svg class="activities-dayof-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"></path></svg>
      <div class="activities-dayof-text"><strong>${esc(activity.name)} today at ${esc(fmt12(slot.start))}</strong>${gear ? ' — ' + esc(gear) : ''}</div>
      <span class="activities-dayof-label">Day-of helper</span>
    </div>`;
  }).join('');
}

function renderActivitiesHub() {
  const listEl = document.getElementById('activities-list');
  if (!listEl) return;
  let items = activitiesItems.slice();
  if (isKidSession()) items = items.filter((a) => a.kidId === sessionUser.kidId);

  if (!items.length) {
    const cta = isKidSession() ? '' : ` <a href="#" onclick="openAddActivityModal();return false">+ New activity</a>`;
    listEl.innerHTML = `<p class="goals-empty">No activities yet.${cta}</p>`;
  } else {
    listEl.innerHTML = items.map(renderActivityCard).join('');
  }
  renderActivitiesDayOfBanner(items);
}

function renderActivityScheduleEditor() {
  const el = document.getElementById('activity-schedule-editor');
  if (!el) return;
  const days = Object.keys(ACTIVITY_DAY_LABEL);
  el.innerHTML = activityScheduleDraft.map((s, i) => `
    <div class="activity-schedule-row">
      <select onchange="activityScheduleDraft[${i}].day=this.value">
        ${days.map((d) => `<option value="${d}"${s.day === d ? ' selected' : ''}>${ACTIVITY_DAY_LABEL[d]}</option>`).join('')}
      </select>
      <input type="time" value="${s.start || ''}" onchange="activityScheduleDraft[${i}].start=this.value">
      <input type="time" value="${s.end || ''}" onchange="activityScheduleDraft[${i}].end=this.value">
      <button type="button" class="hw-checklist-remove" onclick="removeActivityScheduleRow(${i})" aria-label="Remove time">×</button>
    </div>`).join('');
}

function addActivityScheduleRow() {
  activityScheduleDraft.push({ day: 'mon', start: '16:00', end: '' });
  renderActivityScheduleEditor();
}

function removeActivityScheduleRow(i) {
  activityScheduleDraft.splice(i, 1);
  renderActivityScheduleEditor();
}

function openAddActivityModal() {
  editingActivityId = null;
  activityScheduleDraft = [];
  document.getElementById('add-activity-title').textContent = '⚽ New activity';
  document.getElementById('activity-name').value = '';
  document.getElementById('activity-location').value = '';
  document.getElementById('activity-coach-name').value = '';
  document.getElementById('activity-gear').value = '';
  document.getElementById('activity-note').value = '';
  document.getElementById('activity-form-error').textContent = '';
  const sportsInput = document.querySelector('input[name="activity-category"][value="sports"]');
  if (sportsInput) sportsInput.checked = true;
  renderActivityScheduleEditor();

  const kids = (currentFamily && currentFamily.kids) || [];
  const kidSelect = document.getElementById('activity-kid');
  kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">Add a kid first</option>';
  if (activeKidId) kidSelect.value = activeKidId;
  openModal('add-activity-modal');
}

function editActivityItem(id) {
  const item = activitiesItems.find((a) => a.id === id);
  if (!item) return;
  editingActivityId = id;
  activityScheduleDraft = (item.schedule || []).map((s) => Object.assign({}, s));
  document.getElementById('add-activity-title').textContent = '✏️ Edit activity';
  document.getElementById('activity-name').value = item.name;
  document.getElementById('activity-location').value = item.location || '';
  document.getElementById('activity-coach-name').value = item.coachName || '';
  document.getElementById('activity-gear').value = (item.gear || []).join(', ');
  document.getElementById('activity-note').value = item.note || '';
  document.getElementById('activity-form-error').textContent = '';
  const catInput = document.querySelector(`input[name="activity-category"][value="${item.category}"]`);
  if (catInput) catInput.checked = true;
  renderActivityScheduleEditor();

  const kids = (currentFamily && currentFamily.kids) || [];
  const kidSelect = document.getElementById('activity-kid');
  kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
  kidSelect.value = item.kidId;
  openModal('add-activity-modal');
}

async function saveActivityForm(e) {
  e.preventDefault();
  const errEl = document.getElementById('activity-form-error');
  const kidId = document.getElementById('activity-kid').value;
  const name = document.getElementById('activity-name').value.trim();
  const category = document.querySelector('input[name="activity-category"]:checked').value;
  const location = document.getElementById('activity-location').value.trim();
  const coachName = document.getElementById('activity-coach-name').value.trim();
  const gear = document.getElementById('activity-gear').value.split(',').map((s) => s.trim()).filter(Boolean);
  const note = document.getElementById('activity-note').value.trim();
  const schedule = activityScheduleDraft.filter((s) => s.start);
  if (!kidId) { errEl.textContent = 'Add a kid profile first.'; return; }

  try {
    if (editingActivityId) {
      const res = await window.auth.updateActivity(editingActivityId, { name, category, schedule, location, coachName, gear, note });
      const idx = activitiesItems.findIndex((a) => a.id === editingActivityId);
      if (idx >= 0) activitiesItems[idx] = res.activity;
      toast('Activity updated ⚽');
    } else {
      const res = await window.auth.addActivity({ kidId, name, category, schedule, location, coachName, gear, note });
      activitiesItems.push(res.activity);
      toast('Activity added ⚽');
    }
    closeModal('add-activity-modal');
    renderActivitiesHub();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteActivityItem(id) {
  if (!confirm('Delete this activity?')) return;
  try {
    await window.auth.deleteActivity(id);
    activitiesItems = activitiesItems.filter((a) => a.id !== id);
    renderActivitiesHub();
    toast('Activity deleted.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ---------- Calendar fusion: homework "due" chips ----------
   Amber due chips on the week/month calendar, distinct from events,
   respecting the kid switcher + per-kid color (see visibleHomeworkDueItems). */
function visibleHomeworkDueItems() {
  let items = homeworkItems.filter((h) => h.status !== 'done');
  if (activeKidId) items = items.filter((h) => h.kidId === activeKidId);
  return items;
}

/* ============================================================
   NAV TABS (Today / Calendar / Homework / Goals / Activities / Notes / Settings)
   Chat is not a tab — it's the shell-level docked column (see index.html
   #chat-dock), docked on Today/Calendar, collapsed to a slim rail on
   Homework/Goals/Activities, and hidden on Notes/Settings — see
   CHAT_DOCK_MODE/applyChatDockState(). Its poll lifecycle is tied to the
   dock being visible at all (docked or collapsed), so it never polls
   needlessly once hidden.
============================================================ */
function switchNavTab(tab) {
  document.querySelectorAll('.sidebar-nav-item').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
  });
  applyChatDockState(tab);

  // Re-render dynamic panels each time they're opened so they reflect current state.
  if (tab === 'today') { renderTodayScreen(); }
  if (tab === 'settings') { renderManageFamily(); renderSchoolSettings(); }
  if (tab === 'homework') { loadHomework().then(() => { renderHomeworkHub(); applyEnrichmentGating(); updateHomeworkBadge(); }); }
  if (tab === 'goals') { loadGoals().then(() => renderGoalsHub()); }
  if (tab === 'activities') { loadActivities().then(() => renderActivitiesHub()); }
  if (tab === 'notes') { loadNotes(); }

  // Chat is docked/collapsed (not hidden) on every tab except Notes/Settings —
  // keep it live and polling on all of those, stop only where it's hidden.
  if (CHAT_DOCK_MODE[tab] !== 'hidden') {
    loadChatMessages();
    startChatPolling();
  } else {
    stopChatPolling();
  }
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ============================================================
   LOGOUT
============================================================ */
async function handleLogout() {
  try { await window.auth.signOut(); } catch (e) { /* proceed regardless */ }
  window.location.href = '/login';
}

/* ============================================================
   WEB PUSH NOTIFICATIONS (Settings tab)
   Registers a root-scope service worker and lets any session (parent OR
   kid — kids have chat access, so this is deliberately not gated behind
   requireParent) subscribe to browser push for new chat messages.
   Gracefully degrades where the browser/OS doesn't support it — notably
   iOS/iPadOS Safari, which only supports web push for a Home Screen–
   installed PWA, not a regular browser tab.
============================================================ */
let swRegistration = null;

function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

// VAPID public key (base64url, from the server) -> Uint8Array, the shape
// pushManager.subscribe({ applicationServerKey }) requires.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    return swRegistration;
  } catch (e) {
    console.error('Service worker registration failed:', e);
    return null;
  }
}

// Renders the current state of the notifications control:
// 'unsupported' | 'blocked' | 'off' | 'on'
async function renderNotificationsControl() {
  const btn = document.getElementById('notifications-toggle-btn');
  const statusText = document.getElementById('notifications-status-text');
  if (!btn || !statusText) return;

  if (!pushSupported()) {
    btn.style.display = 'none';
    statusText.textContent = "Notifications aren't supported in this browser. On iPhone/iPad, add Fam ETC to your Home Screen first, then enable them.";
    return;
  }

  if (Notification.permission === 'denied') {
    btn.style.display = 'none';
    statusText.textContent = 'Notifications are blocked for this site. Enable them in your browser settings to turn them back on.';
    return;
  }

  btn.style.display = '';
  let isSubscribed = false;
  try {
    const reg = swRegistration || await registerServiceWorker();
    if (reg) {
      const existing = await reg.pushManager.getSubscription();
      isSubscribed = !!existing;
    }
  } catch (e) { /* treat as not subscribed */ }

  if (isSubscribed) {
    btn.textContent = 'Turn off notifications';
    statusText.textContent = "You'll get a notification when a new family chat message arrives.";
  } else {
    btn.textContent = 'Turn on notifications';
    statusText.textContent = 'Notifications are off.';
  }
}

async function handleToggleNotifications() {
  if (!pushSupported()) return;
  const btn = document.getElementById('notifications-toggle-btn');
  if (btn) btn.disabled = true;
  try {
    const reg = swRegistration || await registerServiceWorker();
    if (!reg) {
      toast('❌ Could not set up notifications on this device.');
      return;
    }
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      try { await window.auth.unsubscribeWebPush(existing.endpoint); } catch (e) { /* best effort */ }
      toast('🔕 Notifications turned off');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        await renderNotificationsControl();
        if (permission === 'denied') toast('❌ Notifications blocked. Enable them in your browser settings.');
        return;
      }
      const publicKey = await window.auth.getVapidPublicKey();
      if (!publicKey) {
        toast('❌ Notifications are not configured yet.');
        return;
      }
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await window.auth.subscribeWebPush(subscription.toJSON ? subscription.toJSON() : subscription);
      toast('🔔 Notifications turned on');
    }
  } catch (e) {
    toast('❌ ' + (e.message || 'Could not update notification settings.'));
  } finally {
    if (btn) btn.disabled = false;
    await renderNotificationsControl();
  }
}

/* ============================================================
   LOCAL REMINDERS (web) — mirrors the iOS NotificationScheduler.
   Fires a browser notification 10 min before a calendar event and 8 hrs
   before a homework due time (addressed to the right kid).

   Web constraint (be honest about it): a browser can only fire these while
   Fam ETC is open in a tab or as an installed PWA — there's no OS-level
   pre-scheduling like iOS local notifications. So we set precise in-app
   timers for anything firing within the next window, and roll the window
   forward every 20 min (and whenever the tab regains focus or data changes).
   Closed-tab reminders remain an iOS-only capability (would need Web Push +
   a server-side scheduler).
============================================================ */
const FAM_REMINDER_WINDOW_MS = 12 * 60 * 60 * 1000; // schedule timers up to 12h out
const FAM_REMINDER_MAX = 30;                        // cap concurrent timers
let famReminderTimers = [];

function clearReminderTimers() {
  famReminderTimers.forEach((t) => clearTimeout(t));
  famReminderTimers = [];
}

// Build a local Date from "YYYY-MM-DD" + "HH:mm" in the device timezone.
// Returns null on malformed input so a bad row is skipped, not thrown on.
function famLocalDate(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
  if (!d || !t) return null;
  const hh = +t[1], mm = +t[2];
  if (hh > 23 || mm > 59) return null;
  return new Date(+d[1], +d[2] - 1, +d[3], hh, mm, 0, 0);
}

function fireReminder(title, body, url) {
  const opts = { body, tag: title + '|' + body, data: { url: url || '/' } };
  try {
    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, opts);
    } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => {});
    } else {
      new Notification(title, opts);
    }
  } catch (_) { /* a single failed reminder must never break the loop */ }
}

// Recompute and (re)arm reminder timers. Idempotent: safe to call often.
function scheduleReminders() {
  clearReminderTimers();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const horizon = now + FAM_REMINDER_WINDOW_MS;
  const candidates = [];

  // Calendar events: remind 10 min before start. Use the full family set
  // (unfiltered by active kid) so no one's event is missed.
  const events = getEvents().concat(schoolEvents.map(normalizeSchoolEvent));
  events.forEach((ev) => {
    if (!ev || !ev.time) return;
    const start = famLocalDate(ev.date, ev.time);
    if (!start) return;
    const fireAt = start.getTime() - 10 * 60 * 1000;
    if (fireAt <= now || fireAt > horizon) return;
    let body = 'Starts at ' + fmt12(ev.time);
    if (ev.notes) body += ' — ' + (ev.notes.length > 80 ? ev.notes.slice(0, 80) + '…' : ev.notes);
    candidates.push({ fireAt, title: '📅 Upcoming: ' + ev.title, body, url: '/#calendar' });
  });

  // Homework: remind 8 hrs before the due moment, addressed to the kid.
  homeworkItems.forEach((hw) => {
    if (!hw || hw.status === 'done') return;
    const due = famLocalDate(hw.dueDate, hw.dueTime || '08:00');
    if (!due) return;
    const fireAt = due.getTime() - 8 * 60 * 60 * 1000;
    if (fireAt <= now || fireAt > horizon) return;
    const kidName = hw.kidId ? kidNameFor(hw.kidId) : '';
    const title = '📚 ' + (kidName ? kidName + "'s homework due soon!" : 'Homework due soon!');
    candidates.push({ fireAt, title, body: hw.title + ' — due ' + hw.dueDate, url: '/#homework' });
  });

  candidates.sort((a, b) => a.fireAt - b.fireAt);
  candidates.slice(0, FAM_REMINDER_MAX).forEach((c) => {
    const delay = c.fireAt - Date.now();
    famReminderTimers.push(setTimeout(() => fireReminder(c.title, c.body, c.url), Math.max(0, delay)));
  });
}

// Roll the 12h window forward periodically and when the tab regains focus,
// so a reminder that was beyond the window at load time gets armed in time.
let famReminderInterval = null;
function startReminderLoop() {
  if (famReminderInterval) return;
  scheduleReminders();
  famReminderInterval = setInterval(scheduleReminders, 20 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleReminders();
  });
}

/* ============================================================
   SCHOOL IMPORT BRIDGE (Chrome extension) — Part A
   Stable global entry point the Fam ETC Chrome extension calls after it
   scrapes homework + timetable from an already-logged-in Moodle tab (see
   chrome-extension/). This is intentionally NOT the /api/school/* flow
   (which drives a server-side Moodle login) — the extension already has an
   authenticated session in the browser, so it just hands us parsed data and
   we do the same client-side work the manual "parse schedule" flow does
   (see applyParsedSchedule above) plus a homework POST.

   Payload shape:
     {
       kidId: string,               // Fam ETC kid id (currentFamily.kids[].id)
       moodleUserId: string|number, // informational only, not required
       homework: [{ subject, title, dueDate (YYYY-MM-DD or parseable), completed }],
       timetable: [{ day: 0-4 (Mon-Fri) or 'Mon'.., period, time: 'HH:MM', subject }]
     }
   Returns: { homeworkAdded, eventsAdded, homeworkSkipped } (also toasted).
============================================================ */

// Dedupe key helpers — exported as plain functions so they're easy to unit
// test in isolation if ever pulled into a node-testable module.
function schoolImportHomeworkKey(title, dueDate) {
  return `${String(title || '').trim().toLowerCase()}|${dueDate || ''}`;
}
function schoolImportEventKey(date, time, title) {
  return `${date}|${time || ''}|${String(title || '').trim().toLowerCase()}`;
}

// Normalize a day value from the extension into a 0-4 (Mon-Fri) offset, or
// null if it can't be mapped (weekend / unrecognized — skipped).
function schoolImportDayOffset(day) {
  if (typeof day === 'number' && day >= 0 && day <= 4) return day;
  const map = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
  const key = String(day || '').trim().slice(0, 3).toLowerCase();
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

/* ============================================================
   SCHOOL STATS (house points / attendance / canteen balance) — Part B
   Stored per-kid in localStorage `fam_school_stats`, keyed by Fam ETC kid
   id: { [kidId]: { housePoints, attendance, punctual, canteenBalance,
   updatedAt, lastLowBalanceNotifiedAt } }. Matched from the extension's
   family-wide payload.schoolStats (array of { name, housePoints,
   attendance, punctual, canteenBalance }) by first-name, case-insensitive,
   against currentFamily.kids.

   The pure change-detection comparator (compareSchoolStats) and the kid
   name-matcher (matchKidByFirstName) live in public/js/school-stats.js —
   dependency-free so they're independently unit-testable from node --test
   (see tests/school-stats.test.js) without dragging in this whole
   DOM/localStorage-heavy file.
============================================================ */
const SCHOOL_STATS_KEY = 'fam_school_stats';
const { LOW_BALANCE_THRESHOLD, compareSchoolStats, matchKidByFirstName } = window.famSchoolStats;

function getSchoolStats() {
  return load(SCHOOL_STATS_KEY) || {};
}
function saveSchoolStats(stats) {
  save(SCHOOL_STATS_KEY, stats);
}

// STABLE global read by the dashboard widget (and, in principle, anything
// else that wants the latest school stats without re-deriving storage
// details) — mirrors the famGetSchoolMappings() pattern above.
function famGetSchoolStats() {
  return getSchoolStats();
}
window.famGetSchoolStats = famGetSchoolStats;

// Processes payload.schoolStats: matches each row to a kid, runs the pure
// comparator against the previously-stored value, persists the new
// records, and delivers any fired notifications both as an in-app toast
// and (best-effort, fire-and-forget) a real web push via /api/notify/self
// so it reaches the parent even if the tab is backgrounded.
async function processSchoolStats(kids, statsList) {
  if (!Array.isArray(statsList) || !statsList.length) return;
  const stored = getSchoolStats();
  const now = Date.now();
  let anyMatched = false;

  for (const stat of statsList) {
    if (!stat) continue;
    const kid = matchKidByFirstName(kids, stat.name);
    if (!kid) continue;
    anyMatched = true;

    const prev = stored[kid.id] || null;
    const { record, notifications: fired } = compareSchoolStats(kid.name || stat.name, prev, {
      housePoints: stat.housePoints ?? null,
      attendance: stat.attendance ?? null,
      punctual: stat.punctual ?? null,
      canteenBalance: stat.canteenBalance ?? null,
    }, now);
    stored[kid.id] = record;

    for (const n of fired) {
      toast(`🏫 ${n.title}: ${n.body}`);
      try {
        await window.auth.notifySelf(n.title, n.body, n.tag);
      } catch (e) {
        // Best-effort — push not configured/subscribed, or offline. The
        // toast above already surfaced it in-app.
      }
    }
  }

  if (anyMatched) {
    saveSchoolStats(stored);
    renderSchoolStatsWidget();
  }
}

async function famImportSchoolData(payload) {
  const result = { homeworkAdded: 0, eventsAdded: 0, homeworkSkipped: 0 };
  try {
    if (isKidSession()) {
      toast('Ask a parent to import');
      return result;
    }
    if (!sessionUser || !currentFamily) {
      toast('❌ Please finish loading Fam ETC (sign in) before importing.');
      return result;
    }
    // Resolve which child to import into: an explicit kidId, else a name
    // match, else the only child in the family. No need for the parent to
    // know any internal id.
    const kids = currentFamily.kids || [];
    let kid = null;
    if (payload && payload.kidId) kid = kids.find((k) => k.id === payload.kidId);
    if (!kid && payload && payload.kidName) {
      const n = String(payload.kidName).trim().toLowerCase();
      kid = kids.find((k) => (k.name || '').trim().toLowerCase() === n);
    }
    if (!kid && kids.length === 1) kid = kids[0];
    if (!kid) {
      toast('❌ Import: which child? Enter a name — ' + (kids.map((k) => k.name).join(', ') || 'no children in this family'));
      return result;
    }
    const kidId = kid.id;

    /* ---------- Homework ---------- */
    const hwList = (payload && Array.isArray(payload.homework)) ? payload.homework : [];
    if (hwList.length) {
      let existing;
      try {
        existing = await window.auth.getHomework({ kidId });
      } catch (e) {
        existing = [];
      }
      const existingKeys = new Set(
        (existing || []).map((h) => schoolImportHomeworkKey(h.title, h.dueDate))
      );
      const seenThisRun = new Set();

      for (const hw of hwList) {
        if (!hw || hw.completed) { result.homeworkSkipped++; continue; } // skip completed by default
        const title = String(hw.title || '').trim();
        const dueDate = normalizeSchoolImportDate(hw.dueDate);
        if (!title || !dueDate) { result.homeworkSkipped++; continue; }
        const key = schoolImportHomeworkKey(title, dueDate);
        if (existingKeys.has(key) || seenThisRun.has(key)) { result.homeworkSkipped++; continue; }
        seenThisRun.add(key);

        try {
          await window.auth.addHomework({
            kidId,
            title,
            subject: hw.subject || '',
            dueDate,
            source: 'school-portal',
            notes: hw.setDate ? `Set ${hw.setDate}` : '',
          });
          result.homeworkAdded++;
        } catch (e) {
          result.homeworkSkipped++;
        }
      }
    }

    /* ---------- Timetable -> calendar events (current Mon-Fri) ---------- */
    const ttList = (payload && Array.isArray(payload.timetable)) ? payload.timetable : [];
    if (ttList.length) {
      const monday = mondayOf(new Date());
      const events = getEvents();
      const existingKeys = new Set(events.map((e) => schoolImportEventKey(e.date, e.time, e.title)));

      for (const lesson of ttList) {
        if (!lesson) continue;
        const offset = schoolImportDayOffset(lesson.day);
        if (offset === null) continue;
        const title = String(lesson.subject || '').trim();
        const time = String(lesson.time || '').trim();
        if (!title || !time) continue;
        const date = isoDate(new Date(+monday + offset * 86400000));
        const key = schoolImportEventKey(date, time, title);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        events.push({
          id: uid(),
          userId: sessionUser.id,
          kidId,
          title,
          date,
          time,
          endTime: '',
          category: 'school',
          notes: 'Timetable',
          source: 'timetable-import',
        });
        result.eventsAdded++;
      }

      if (result.eventsAdded > 0) {
        saveEvents(events);
        loadFamilyEvents(); // push to the server (silent — no chat flood)
        renderCalendar();
        renderMiniCal();
      }
    }

    /* ---------- School stats (house points/attendance/canteen) ----------
       Family-wide, not scoped to the single `kid` resolved above — each row
       is matched independently by first name against every kid in the
       family (see processSchoolStats/matchKidByFirstName). ---------- */
    const statsList = (payload && Array.isArray(payload.schoolStats)) ? payload.schoolStats : [];
    if (statsList.length) {
      try {
        await processSchoolStats(kids, statsList);
      } catch (e) {
        // Best-effort — never let a stats hiccup block the homework/timetable
        // import result the parent is waiting on.
      }
    }

    toast(`🎓 Imported: ${result.homeworkAdded} homework, ${result.eventsAdded} timetable events` +
      (result.homeworkSkipped ? ` (${result.homeworkSkipped} skipped)` : ''));
    return result;
  } catch (e) {
    toast(`❌ Import failed: ${(e && e.message) || 'unknown error'}`);
    return result;
  }
}

// Homework dates from Moodle look like "Thu 18 June" (no year) — infer the
// academic year: Aug-Dec = the earlier calendar year of the current
// Aug-Jul school year, Jan-Jul = the later one. Already-ISO dates pass
// through unchanged. Returns null if unparseable.
function normalizeSchoolImportDate(raw, now) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (!m) return null;
  const dayNum = parseInt(m[1], 10);
  const monthIdx = MONTHS.indexOf(m[2].toLowerCase());
  if (monthIdx === -1 || !dayNum) return null;

  let year;
  if (m[3]) {
    year = parseInt(m[3], 10);
  } else {
    const today = now || new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth(); // 0-11
    // Academic year runs Aug (7) -> Jul (6). If we're currently in the
    // Aug-Dec half, that half's calendar year is curYear; the Jan-Jul half
    // that follows is curYear+1. If we're in the Jan-Jul half, that half is
    // curYear and the preceding Aug-Dec half was curYear-1.
    const academicStartYear = curMonth >= 7 ? curYear : curYear - 1;
    year = monthIdx >= 7 ? academicStartYear : academicStartYear + 1;
  }
  return isoDate(new Date(year, monthIdx, dayNum));
}

// The chrome extension's background.js calls window.famImportSchoolData(...)
// directly via chrome.scripting.executeScript (see chrome-extension/
// background.js) — no postMessage bridge needed, so none is registered here.
window.famImportSchoolData = famImportSchoolData;

/* ============================================================
   INIT
============================================================ */
async function init() {
  migrateLegacyStorage();
  const ok = await bootstrapSession();
  if (!ok) return; // redirected to /login
  showDashboard();
  startKidRequestPolling(); // parents: surface pending kid sign-in requests
  registerServiceWorker().then(renderNotificationsControl).then(startReminderLoop);
}

document.addEventListener('DOMContentLoaded', init);
