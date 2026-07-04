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

const FACTS = [
  { icon: "🍯", type: "Science",  text: "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible!" },
  { icon: "🌊", type: "Science",  text: "Oceans cover about 71% of Earth's surface, yet more than 80% of the world's oceans remain unmapped and unexplored by humans." },
  { icon: "🦋", type: "Science",  text: "A caterpillar dissolves almost completely into liquid inside its chrysalis before reorganizing into a butterfly — it rebuilds itself from scratch!" },
  { icon: "🏛️", type: "History", text: "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid. The pyramids are that ancient!" },
  { icon: "⚡", type: "Science",  text: "Lightning strikes Earth about 100 times every second — that's 8 million lightning bolts per day!" },
  { icon: "🐙", type: "Science",  text: "Octopuses have three hearts, blue blood, and can change the color and texture of their skin in less than a second." },
  { icon: "🌙", type: "Science",  text: "The Moon is slowly drifting away from Earth at about 3.8 cm per year — the same rate your fingernails grow!" },
  { icon: "🦴", type: "Science",  text: "You're born with about 270 bones, but by adulthood you have 206 because many fuse together as you grow." },
  { icon: "📜", type: "History", text: "In medieval Europe, pepper was so valuable it was used as currency. Some merchants paid their rent in peppercorns!" },
  { icon: "🧠", type: "Science",  text: "Your brain uses about 20% of your body's total energy, even though it only makes up about 2% of your body weight." },
  { icon: "🌳", type: "Science",  text: "There are more trees on Earth than stars in the Milky Way galaxy — approximately 3 trillion trees versus 200–400 billion stars." },
  { icon: "🐘", type: "Science",  text: "Elephants are the only animals known to hold memorial gatherings for their dead — they mourn and revisit the bones of lost family members." },
  { icon: "⚗️", type: "Science",  text: "Water is the only substance on Earth that naturally exists in all three states — solid (ice), liquid, and gas (steam) — at normal temperatures." },
  { icon: "🗺️", type: "History", text: "The first map of the world was drawn by Greek philosopher Anaximander around 550 BC. It showed the world as a flat disk surrounded by ocean." },
  { icon: "🎭", type: "History", text: "In ancient Greece, all actors were male and wore large masks so audiences could see expressions from far away. This is the origin of the theater comedy/tragedy symbols!" },
  { icon: "🔭", type: "Science",  text: "When you look at a star, you see it as it was years, decades, or even millions of years ago. Some stars we can see may no longer exist!" },
  { icon: "🏹", type: "History", text: "The shortest war in history lasted only 38–45 minutes. It was between Britain and Zanzibar on August 27, 1896." },
  { icon: "🐬", type: "Science",  text: "Dolphins sleep with one eye open. They rest half their brain at a time so they can continue breathing and watching for danger." },
  { icon: "🌞", type: "Science",  text: "The Sun makes up 99.86% of the mass of our entire Solar System. Everything else — planets, moons, asteroids — is just 0.14%!" },
  { icon: "🦠", type: "Science",  text: "There are more bacteria in your mouth right now than there are people on Earth — about 20 billion bacteria call your mouth home!" },
  { icon: "🎵", type: "Science",  text: "Music triggers the same pleasure centers in the brain as food and hugs. That's why your favorite song can give you chills!" },
  { icon: "🌈", type: "Science",  text: "Rainbows are actually full circles — you can only see half from the ground. Pilots in planes sometimes see complete circular rainbows!" },
  { icon: "⚔️", type: "History", text: "The word 'berserk' comes from 'berserkers' — elite Norse Viking warriors who would fight in a fierce, trance-like fury." },
  { icon: "🌿", type: "Science",  text: "Bamboo is the fastest-growing plant on Earth. Some species can grow up to 91 cm (3 feet) in a single day!" },
  { icon: "🏺", type: "History", text: "The ancient Romans used urine to whiten their teeth and clean clothes. Urine collectors would stand on street corners with buckets!" },
  { icon: "💎", type: "Science",  text: "Tooth enamel is the hardest substance in the human body — harder than bone! But unlike bone, it cannot repair itself once damaged." },
  { icon: "🌋", type: "Science",  text: "There are more volcanoes under the ocean than on land. Most of Earth's volcanic activity happens along the 40,000-mile-long mid-ocean ridge." },
  { icon: "🐝", type: "Science",  text: "A single honeybee will produce only 1/12 teaspoon of honey in its entire lifetime. It takes about 60,000 bees to fill one jar of honey!" },
  { icon: "📚", type: "History", text: "The Library of Alexandria contained an estimated 400,000–700,000 scrolls, making it the largest library in the ancient world." },
  { icon: "🪐", type: "Science",  text: "Saturn's rings are mostly made of ice and rock particles ranging in size from grains of sand to boulders as large as a house." },
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
let pendingDate     = null;   // pre-filled date for add-event modal
let uploadedFile    = null;

/* Chat */
let chatMessages    = [];     // messages currently rendered, oldest-first
let chatLastAt      = null;   // createdAt cursor for polling ?since=
let chatPollTimer   = null;
const CHAT_POLL_MS  = 2000;

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

const MOOD_OPTIONS = [
  { emoji: '😄', label: 'Great' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '😔', label: 'Down' },
  { emoji: '😣', label: 'Stressed' },
  { emoji: '😡', label: 'Angry' },
];
let selectedMood = null;

function satPlacementKey() {
  return `fam_sat_placement_done_${sessionUser ? sessionUser.id : 'anon'}`;
}

/* ---------- gating: homework due today > 3 disables enrichment cards ---------- */
function homeworkDueTodayCount() {
  const today = isoDate(new Date());
  return homeworkItems.filter((h) => h.dueDate === today && h.status !== 'done').length;
}

function applyEnrichmentGating() {
  const dueCount = homeworkDueTodayCount();
  const locked = dueCount > 3;
  const lockIds = ['lock-quote', 'lock-sat', 'lock-mood', 'lock-news', 'lock-quiz'];
  const cardIds = ['widget-quote', 'widget-word', 'widget-mood', 'widget-news', 'widget-quiz'];
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

/* ---------- Notes tab ---------- */
function noteSourceChip(source) {
  const map = {
    quote:  { icon: '📌', label: 'Quote' },
    sat:    { icon: '🔤', label: 'SAT word' },
    chat:   { icon: '💬', label: 'Chat' },
    social: { icon: '💗', label: 'Feelings' },
    news:   { icon: '📰', label: 'News' },
    manual: { icon: '📝', label: 'Note' },
  };
  return map[source] || map.manual;
}

function friendlyNoteDate(dateStr) {
  const d = parseIso(dateStr);
  const today = isoDate(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === today) return 'Today';
  if (dateStr === isoDate(yesterday)) return 'Yesterday';
  return formatLong(d);
}

async function loadNotes() {
  try {
    notesItems = await window.auth.getNotes(isKidSession() ? {} : {});
  } catch (e) {
    notesItems = [];
  }
  renderNotesTimeline();
  return notesItems;
}

function renderNotesTimeline() {
  const el = document.getElementById('notes-timeline');
  if (!el) return;
  if (!notesItems.length) {
    el.innerHTML = '<p class="text-muted">No notes yet — reflections you save from Quote, SAT, News, feelings check-ins, and pinned chat messages will show up here.</p>';
    return;
  }
  // Group by date, preserving the already-desc-by-date-then-createdAt server order.
  const groups = [];
  let lastDate = null;
  notesItems.forEach((n) => {
    if (n.date !== lastDate) {
      groups.push({ date: n.date, notes: [] });
      lastDate = n.date;
    }
    groups[groups.length - 1].notes.push(n);
  });

  el.innerHTML = groups.map((g) => {
    const rows = g.notes.map((n) => {
      const chip = noteSourceChip(n.source);
      // The actual content the note was made on (quote / message / word) is the
      // prominent subject; the person's own words (reflection) come after it.
      const context = (n.ref && n.ref.context) ? n.ref.context : '';
      const contentBlock = context ? `<div class="note-content">${esc(context)}</div>` : '';
      const showBody = n.body && n.body !== context;
      const bodyBlock = showBody ? `<div class="note-body">${context ? '💭 ' : ''}${esc(n.body)}</div>` : '';
      const canEdit = sessionUser && n.authorId === sessionUser.id;
      const del = canEdit ? `<button class="btn-link-danger note-delete-btn" onclick="handleDeleteNote('${n.id}')" title="Delete note">🗑️</button>` : '';
      return `<div class="note-item">
        <div class="note-item-header">
          <span class="note-source-chip note-source-${esc(n.source || 'manual')}">${chip.icon} ${chip.label}</span>
          ${del}
        </div>
        ${contentBlock}
        ${bodyBlock}
      </div>`;
    }).join('');
    return `<div class="notes-day-group">
      <div class="notes-day-header">${esc(friendlyNoteDate(g.date))}</div>
      ${rows}
    </div>`;
  }).join('');
}

function openAddNoteComposer() {
  const composer = document.getElementById('notes-composer');
  if (composer) { composer.hidden = false; document.getElementById('notes-composer-text').focus(); }
}

function closeAddNoteComposer() {
  const composer = document.getElementById('notes-composer');
  if (composer) { composer.hidden = true; document.getElementById('notes-composer-text').value = ''; }
}

async function handleSaveManualNote() {
  const textEl = document.getElementById('notes-composer-text');
  const body = textEl ? textEl.value.trim() : '';
  if (!body) return;
  try {
    const res = await window.auth.addNote({ body, source: 'manual' });
    if (res && res.note) notesItems.unshift(res.note);
    closeAddNoteComposer();
    renderNotesTimeline();
    toast('📝 Note saved');
  } catch (err) { toast(`❌ ${err.message}`); }
}

async function handleDeleteNote(id) {
  try {
    await window.auth.deleteNote(id);
    notesItems = notesItems.filter((n) => n.id !== id);
    renderNotesTimeline();
    toast('Note deleted.');
  } catch (err) { toast(`❌ ${err.message}`); }
}

async function saveNoteFromWidget(body, source, ref) {
  try {
    const res = await window.auth.addNote({ body, source, ref });
    if (res && res.note) {
      notesItems.unshift(res.note);
      renderNotesTimeline();
    }
    toast('📝 Saved to Notes');
    return res && res.note;
  } catch (err) {
    toast(`❌ ${err.message}`);
    return null;
  }
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

/* ---------- Social-emotional check-in widget ---------- */
function renderMoodWidget() {
  selectedMood = null;
  const row = document.getElementById('mood-row');
  if (!row) return;
  row.innerHTML = MOOD_OPTIONS.map((m, i) =>
    `<button type="button" class="fam-mood-opt" data-i="${i}" onclick="selectMood(${i})" title="${esc(m.label)}">${m.emoji}</button>`
  ).join('');
  const textEl = document.getElementById('mood-text');
  if (textEl) textEl.value = '';
}

function selectMood(i) {
  selectedMood = i;
  document.querySelectorAll('#mood-row .fam-mood-opt').forEach((btn, idx) => {
    btn.classList.toggle('selected', idx === i);
  });
}

async function saveMoodCheckIn() {
  if (selectedMood === null) { toast('Pick a feeling first 🙂'); return; }
  const m = MOOD_OPTIONS[selectedMood];
  const textEl = document.getElementById('mood-text');
  const extra = textEl ? textEl.value.trim() : '';
  const body = `Feeling ${m.emoji} ${m.label}.${extra ? ' ' + extra : ''}`;
  const note = await saveNoteFromWidget(body, 'social');
  if (note) renderMoodWidget();
}

/* ---------- News widget: reflection ---------- */
async function saveNewsReflection() {
  const textEl = document.getElementById('news-reflect-text');
  const body = textEl ? textEl.value.trim() : '';
  if (!body) { toast('Write a few words first 🙂'); return; }
  const note = await saveNoteFromWidget(body, 'news', { kind: 'news', id: '', context: currentNews ? currentNews.headline : '' });
  if (note) textEl.value = '';
}

/* ---------- SAT word widget: daily activity + word bank + pop quiz ---------- */
function renderSatActivity() {
  const w = currentSatWord;
  const container = document.getElementById('sat-activity');
  if (!w || !container) return;

  // First-run placement step: "do you already know these?"
  const placementEl = document.getElementById('sat-placement');
  if (placementEl && !load(satPlacementKey())) {
    const sample = SAT_WORDS.slice(0, 6);
    placementEl.hidden = false;
    placementEl.innerHTML = `
      <div class="fam-sat-placement-title">Do you already know these words?</div>
      <div class="fam-sat-placement-list">
        ${sample.map((s, i) => `<label class="fam-sat-placement-item"><input type="checkbox" data-word="${esc(s.word)}"> ${esc(s.word)}</label>`).join('')}
      </div>
      <button type="button" class="btn-secondary" onclick="submitSatPlacement()">Continue</button>`;
  } else if (placementEl) {
    placementEl.hidden = true;
  }

  // Rotate today's activity by day-of-year % 3.
  const task = dayOfYear(new Date()) % 3;
  if (task === 0) {
    // (1) pick the sentence using the word correctly
    const wrongWord = SAT_WORDS[(SAT_WORDS.indexOf(w) + 5) % SAT_WORDS.length];
    const correctSentence = w.example;
    const wrongSentence = wrongWord.example.replace(new RegExp(wrongWord.word, 'i'), w.word);
    const options = Math.random() < 0.5 ? [correctSentence, wrongSentence] : [wrongSentence, correctSentence];
    container.innerHTML = `
      <div class="fam-sat-task-title">Which sentence uses "${esc(w.word)}" correctly?</div>
      <div class="fam-sat-options">
        ${options.map((s, i) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${s === correctSentence})">${esc(s)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  } else if (task === 1) {
    // (2) fill-in-the-blank — choose the word
    const others = SAT_WORDS.filter((s) => s.word !== w.word).sort(() => Math.random() - 0.5).slice(0, 3).map((s) => s.word);
    const options = [w.word, ...others].sort(() => Math.random() - 0.5);
    const blanked = w.example.replace(new RegExp(w.word, 'i'), '_____');
    container.innerHTML = `
      <div class="fam-sat-task-title">Fill in the blank: ${esc(blanked)}</div>
      <div class="fam-sat-options">
        ${options.map((opt) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${opt === w.word})">${esc(opt)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  } else {
    // (3) choose the correct definition
    const others = SAT_WORDS.filter((s) => s.word !== w.word).sort(() => Math.random() - 0.5).slice(0, 3).map((s) => s.def);
    const options = [w.def, ...others].sort(() => Math.random() - 0.5);
    container.innerHTML = `
      <div class="fam-sat-task-title">Which is the definition of "${esc(w.word)}"?</div>
      <div class="fam-sat-options">
        ${options.map((opt) => `<button type="button" class="fam-sat-opt" onclick="answerSatActivity(${opt === w.def})">${esc(opt)}</button>`).join('')}
      </div>
      <div class="fam-sat-feedback" id="sat-activity-feedback"></div>`;
  }
}

function submitSatPlacement() {
  const checked = Array.from(document.querySelectorAll('#sat-placement input[type=checkbox]:checked')).map((el) => el.dataset.word);
  save(satPlacementKey(), true);
  const placementEl = document.getElementById('sat-placement');
  if (placementEl) placementEl.hidden = true;
  if (checked.length) {
    window.auth.wordBankPlacement(checked).then(() => loadWordBank()).catch(() => {});
  }
}

async function answerSatActivity(correct) {
  const btns = document.querySelectorAll('#sat-activity .fam-sat-opt');
  btns.forEach((b) => { b.disabled = true; });
  const fb = document.getElementById('sat-activity-feedback');
  if (fb) {
    fb.textContent = correct ? '✅ Nice work!' : '❌ Not quite — try tomorrow\'s activity!';
    fb.className = 'fam-sat-feedback ' + (correct ? 'correct' : 'wrong');
  }
  if (currentSatWord) {
    try {
      const res = await window.auth.wordBankInteract(currentSatWord.word, correct);
      if (res && res.entry) mergeWordBankEntry(res.entry);
    } catch (e) { /* best effort */ }
  }
}

function mergeWordBankEntry(entry) {
  const idx = wordBankState.words.findIndex((w) => w.word === entry.word);
  if (idx >= 0) wordBankState.words[idx] = entry;
  else wordBankState.words.push(entry);
  renderWordBankPanel();
  updateQuizButtonState();
}

async function loadWordBank() {
  try {
    const res = await window.auth.getWordBank();
    wordBankState = { words: (res && res.words) || [], stats: (res && res.stats) || { learning: 0, mastered: 0, known: 0 } };
  } catch (e) {
    wordBankState = { words: [], stats: { learning: 0, mastered: 0, known: 0 } };
  }
  renderWordBankPanel();
  updateQuizButtonState();
}

function toggleWordBank() {
  const panel = document.getElementById('sat-wordbank-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderWordBankPanel();
}

function renderWordBankPanel() {
  const panel = document.getElementById('sat-wordbank-panel');
  if (!panel) return;
  const s = wordBankState.stats || {};
  const header = `<div class="fam-wb-stats">Learning: ${s.learning || 0} · Mastered: ${s.mastered || 0} · Known: ${s.known || 0}</div>`;
  if (!wordBankState.words.length) {
    panel.innerHTML = header + '<p class="text-muted">No words banked yet — answer today\'s activity to get started!</p>';
    return;
  }
  const rows = wordBankState.words.map((w) => {
    const stateLabel = w.state === 'mastered' ? '⭐ Mastered' : w.state === 'known' ? '✅ Known' : `📖 Learning (${w.correctCount || 0}/3)`;
    return `<div class="fam-wb-row"><span class="fam-wb-word">${esc(w.word)}</span><span class="fam-wb-state">${stateLabel}</span></div>`;
  }).join('');
  panel.innerHTML = header + rows;
}

function updateQuizButtonState() {
  const btn = document.getElementById('sat-quiz-btn');
  if (!btn) return;
  const quizzable = wordBankState.words.filter((w) => w.state === 'mastered' || w.state === 'known' || w.seenCount).length;
  btn.disabled = quizzable < 2;
}

async function startWordQuiz() {
  const panel = document.getElementById('sat-quiz-panel');
  if (!panel) return;
  try {
    const res = await window.auth.wordBankQuiz(5);
    wordQuizState = { questions: (res && res.questions) || [], index: 0 };
    if (res && res.needMore) {
      panel.hidden = false;
      panel.innerHTML = '<p class="text-muted">Answer a few more activities first to unlock the pop quiz!</p>';
      return;
    }
  } catch (e) {
    wordQuizState = { questions: [], index: 0 };
    panel.hidden = false;
    panel.innerHTML = '<p class="text-muted">Pop quiz isn\'t available right now — try again soon.</p>';
    return;
  }
  panel.hidden = false;
  renderWordQuizQuestion();
}

function renderWordQuizQuestion() {
  const panel = document.getElementById('sat-quiz-panel');
  if (!panel) return;
  const { questions, index } = wordQuizState;
  if (!questions.length) {
    panel.innerHTML = '<p class="text-muted">No quiz questions yet — keep working on the daily activity!</p>';
    return;
  }
  if (index >= questions.length) {
    panel.innerHTML = '<p class="fam-wb-quiz-done">🎉 Pop quiz complete — great work!</p>';
    return;
  }
  const q = questions[index];
  panel.innerHTML = `
    <div class="fam-wb-quiz-progress">${index + 1}/${questions.length}</div>
    <div class="fam-wb-quiz-prompt">${esc(q.prompt)}</div>
    <div class="fam-sat-options">
      ${q.options.map((opt, i) => `<button type="button" class="fam-sat-opt" onclick="answerWordQuiz(${i})">${esc(opt)}</button>`).join('')}
    </div>
    <div class="fam-sat-feedback" id="word-quiz-feedback"></div>`;
}

async function answerWordQuiz(chosenIndex) {
  const { questions, index } = wordQuizState;
  const q = questions[index];
  const correct = chosenIndex === q.answerIndex;
  const btns = document.querySelectorAll('#sat-quiz-panel .fam-sat-opt');
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.answerIndex) b.classList.add('correct');
    else if (i === chosenIndex) b.classList.add('wrong');
  });
  const fb = document.getElementById('word-quiz-feedback');
  if (fb) { fb.textContent = correct ? '✅ Correct!' : '❌ Not quite.'; fb.className = 'fam-sat-feedback ' + (correct ? 'correct' : 'wrong'); }
  try {
    const res = await window.auth.wordBankInteract(q.word, correct);
    if (res && res.entry) mergeWordBankEntry(res.entry);
  } catch (e) { /* best effort */ }
  setTimeout(() => {
    wordQuizState.index++;
    renderWordQuizQuestion();
  }, 1000);
}

async function handlePinSatWord() {
  if (!currentSatWord) return;
  const full = `${currentSatWord.word} — ${currentSatWord.def}`;
  await saveNoteFromWidget(full, 'sat', { kind: 'sat', id: currentSatWord.word, context: full });
}

/* ---------- chat: pin a message to notes ---------- */
async function handlePinChatMessage(id) {
  const msg = chatMessages.find((m) => m.id === id);
  if (!msg || !msg.text) return;
  await saveNoteFromWidget(msg.text, 'chat', { kind: 'chat', id: msg.id, context: msg.text });
}

/* ============================================================
   UTILITIES
============================================================ */
function dayOfYear(d) {
  const jan1 = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - jan1) / 86400000);
}

function dailyPick(arr, date) {
  return arr[dayOfYear(date || new Date()) % arr.length];
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIso(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLong(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmt12(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function mondayOf(d) {
  const copy = new Date(d);
  const dow = copy.getDay();
  copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Storage helpers (fam_ prefix only) */
function load(key)        { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } }
function save(key, val)   { localStorage.setItem(key, JSON.stringify(val)); }

function getEvents()   { return load('fam_events')   || []; }
function saveEvents(e) { save('fam_events', e); }
function getSchedules(){ return load('fam_schedules')|| []; }
function saveSched(s)  { save('fam_schedules', s); }

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

function renderKidSwitcher() {
  const el = document.getElementById('kid-switcher');
  if (!el || !currentFamily) return;
  const kids = currentFamily.kids || [];

  // A kid session is locked to its own profile — no "All kids" view and no
  // switching to a sibling. Render a single, non-interactive chip instead.
  if (isKidSession()) {
    const mine = kids.find((k) => k.id === sessionUser.kidId);
    activeKidId = sessionUser.kidId || null;
    el.innerHTML = mine
      ? `<span class="kid-chip active" style="--kid-color:${mine.color}">${esc(mine.name)}</span>`
      : '';
    return;
  }

  const chips = [`<button class="kid-chip${activeKidId === null ? ' active' : ''}" onclick="setActiveKid(null)">All kids</button>`]
    .concat(kids.map((k) =>
      `<button class="kid-chip${activeKidId === k.id ? ' active' : ''}" style="--kid-color:${k.color}" onclick="setActiveKid('${k.id}')">${esc(k.name)}</button>`
    ));
  el.innerHTML = chips.join('');
}

function setActiveKid(kidId) {
  activeKidId = kidId;
  renderKidSwitcher();
  renderCalendar();
  renderMiniCal();
  renderSchoolStatsWidget();
}

function renderManageFamily() {
  applyRoleScopingToUI();
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
      <a href="#" onclick="showFirstRunPanel();return false" style="color:var(--primary);font-weight:700">Create or join a family</a> to add parents and kids.</p>`;
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
        <span class="kid-row-swatch" style="background:${k.color}"></span>
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
  const dateEl = document.getElementById('header-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const av = document.getElementById('user-avatar');
  if (av) av.textContent = (sessionUser.name || '?')[0].toUpperCase();
  const nameDisplay = document.getElementById('user-name-display');
  if (nameDisplay) nameDisplay.textContent = sessionUser.name || '';

  weekStart = mondayOf(now);
  monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  miniMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  renderMiniCal();
  renderCalendar();
  renderWidgets();
  renderUploads();
  renderStreak();
  renderManageFamily();

  // Homework (Phase 3): load once up front so calendar "due" chips render on
  // first paint; the Homework tab reloads on its own each time it's opened.
  loadHomework().then(() => { renderCalendar(); applyEnrichmentGating(); });

  // Notes: load once up front so the Notes tab is ready and pin affordances
  // elsewhere have fresh state; the Notes tab reloads on its own when opened.
  loadNotes();

  // School calendar: load subscriptions then auto-sync (throttled ~1/hour
  // both client- and server-side) — fire-and-forget so the dashboard never
  // blocks on a slow feed fetch.
  loadSchoolFeedsInfo().then(() => {
    renderSchoolSettings();
    syncSchoolCalendar({ silent: false, showToast: false });
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
  const evDates = new Set(visibleEvents().map(e => e.date));
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

function visibleEvents() {
  const events = getEvents();
  const school = schoolEvents.map(normalizeSchoolEvent);
  const merged = events.concat(school);
  if (!activeKidId) return merged;
  return merged.filter(e => e.kidId === activeKidId || (e.source === 'school' && !e.kidId));
}

function renderCalendar() {
  currentView === 'week' ? renderWeekView() : renderMonthView();
}

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
    const evs = events.filter(e => e.date === ds);
    const dueHw = visibleHomeworkDueItems().filter(h => h.dueDate === ds);
    html += `<div class="week-day-col${isT?' is-today':''}${isW?' is-weekend':''}">
      <div class="week-day-col-hdr">
        <div class="wday-name">${days[i]}</div>
        <div class="wday-num">${d.getDate()}</div>
      </div>
      <div class="week-day-events">
        ${dueHw.map(h => `
          <div class="week-evt hw-due-chip" onclick="switchNavTab('homework');openHomeworkDetail('${h.id}')" title="Homework due">
            <span class="hw-due-icon">📚</span>${esc(h.title)}
          </div>`).join('')}
        ${evs.map(ev => `
          <div class="week-evt c-${ev.category}${ev.source === 'school' ? ' school-evt' : ''}" onclick="showDetail('${ev.id}')">
            ${ev.time ? `<span class="evt-time">${fmt12(ev.time)}</span>` : ''}
            ${ev.source === 'school' ? '<span class="school-badge" title="Synced from school calendar — read-only">🎓</span>' : ''}
            ${esc(ev.title)}
          </div>`).join('')}
        <button class="week-add-btn" onclick="openAddEventModal('${ds}')">+ Add</button>
      </div>
    </div>`;
  }
  html += '</div>';
  document.getElementById('calendar-grid').innerHTML = html;
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
    const evs  = events.filter(e => e.date === ds);
    const dueHw = visibleHomeworkDueItems().filter(h => h.dueDate === ds);
    html += `<div class="month-day${isT?' is-today':''}" onclick="openAddEventModal('${ds}')">
      <span class="mday-num">${isT ? `<span>${day}</span>` : day}</span>
      ${dueHw.slice(0,3).map(h =>
        `<span class="month-evt hw-due-chip" onclick="event.stopPropagation();switchNavTab('homework');openHomeworkDetail('${h.id}')" title="Homework due">📚 ${esc(h.title)}</span>`
      ).join('')}
      ${evs.slice(0,3).map(ev =>
        `<span class="month-evt chip-${ev.category}${ev.source === 'school' ? ' school-evt' : ''}" onclick="event.stopPropagation();showDetail('${ev.id}')">${ev.source === 'school' ? '🎓 ' : ''}${esc(ev.title)}</span>`
      ).join('')}
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
      <span class="kid-row-swatch" style="background:${k.color}"></span>
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
   SCHOOL CALENDAR SYNC (Phase 2)
   Server-sourced, read-only events merged into the calendar views.
   Auto-syncs (throttled ~1/hour server-side) on app open; "Sync now"
   in Settings forces a refetch. See lib/school-feeds.js for the
   windowing/dedup/deadline-flagging logic.
============================================================ */
let lastSchoolSyncAttempt = null; // client-side guard so app-open doesn't hammer the endpoint on every tab switch

async function loadSchoolFeedsInfo() {
  try {
    schoolFeedsInfo = await window.auth.getCalendarFeeds();
  } catch (e) {
    schoolFeedsInfo = null;
  }
  return schoolFeedsInfo;
}

async function syncSchoolCalendar(opts) {
  const { force = false, silent = false, showToast = false } = opts || {};
  const now = Date.now();
  if (!force && lastSchoolSyncAttempt && (now - lastSchoolSyncAttempt) < SCHOOL_AUTO_SYNC_MIN_MS) {
    return; // client-side throttle mirrors the server's ~1/hour guard
  }
  lastSchoolSyncAttempt = now;
  try {
    const result = await window.auth.syncCalendar(force);
    schoolEvents = result.events || [];
    schoolSyncErrors = result.errors || [];
    renderCalendar();
    renderMiniCal();
    renderSchoolSettings();
    scheduleReminders();
    if (schoolSyncErrors.length && !silent) {
      const names = schoolSyncErrors.map(e => e.label).join(', ');
      toast(`⚠️ Couldn't sync: ${names}`);
    } else if (showToast) {
      const deadlineCount = schoolEvents.filter(e => e.isDeadline).length;
      toast(`Synced ${schoolEvents.length} school events, ${deadlineCount} deadlines 🎓`);
    }
  } catch (e) {
    if (!silent) toast(`❌ Could not sync school calendars: ${e.message || 'unknown error'}`);
  }
}

async function handleSyncNowClick() {
  const btn = document.getElementById('school-sync-now-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  await loadSchoolFeedsInfo();
  await syncSchoolCalendar({ force: true, showToast: true });
  if (btn) { btn.disabled = false; btn.textContent = 'Sync now 🔄'; }
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} hr ago`;
  return `${Math.round(ms / 86400000)} day${Math.round(ms / 86400000) === 1 ? '' : 's'} ago`;
}

/* ---------- Settings > School calendars ---------- */
function renderSchoolSettings() {
  const el = document.getElementById('school-calendars-list');
  const lastSyncedEl = document.getElementById('school-last-synced');
  if (!el || isKidSession()) return;

  if (lastSyncedEl) {
    lastSyncedEl.textContent = schoolFeedsInfo && schoolFeedsInfo.lastSyncAt
      ? `Last synced ${timeAgo(schoolFeedsInfo.lastSyncAt)}`
      : 'Never synced yet';
  }

  if (!currentFamily) {
    el.innerHTML = '<p class="text-muted">Create or join a family first to subscribe kids to school calendars.</p>';
    return;
  }
  const kids = currentFamily.kids || [];
  if (!kids.length) {
    el.innerHTML = '<p class="text-muted">Add a kid profile above, then subscribe them to their school calendars here.</p>';
    return;
  }

  const builtin = (schoolFeedsInfo && schoolFeedsInfo.builtin) || [];
  const subs = (schoolFeedsInfo && schoolFeedsInfo.subscriptions) || [];
  const subKey = (kidId, feedId, customUrl) => subs.find(s => s.kidId === kidId && (feedId ? s.feedId === feedId : s.customUrl === customUrl));

  let html = '';

  // Built-in St Andrews feeds — per-kid checkbox grid. Pin the column count to
  // the number of kids (auto-fit resolves by width, which wrapped extra kids
  // onto their own rows).
  const feedCols = `grid-template-columns:minmax(0,1fr) repeat(${kids.length},minmax(56px,72px))`;
  html += '<div class="school-feed-table">';
  html += `<div class="school-feed-row school-feed-hdr" style="${feedCols}">
      <span></span>${kids.map(k => `<span class="school-feed-kid-hdr" style="color:${k.color}">${esc(k.name)}</span>`).join('')}
    </div>`;
  builtin.forEach(feed => {
    html += `<div class="school-feed-row" style="${feedCols}">
        <span class="school-feed-name">${esc(feed.name)}${feed.deadline ? ' <span class=\"school-feed-deadline-tag\">deadlines</span>' : ''}</span>
        ${kids.map(k => {
          const existing = subKey(k.id, feed.id);
          const checked = existing ? 'checked' : '';
          return `<label class="school-feed-checkbox"><input type="checkbox" ${checked} onchange="handleToggleBuiltinFeed('${k.id}','${feed.id}',this.checked)"></label>`;
        }).join('')}
      </div>`;
  });
  html += '</div>';

  // Custom / club feeds already subscribed.
  const customSubs = subs.filter(s => s.customUrl);
  if (customSubs.length) {
    html += '<h4 style="margin:18px 0 8px">Your custom calendars</h4>';
    html += customSubs.map(s => {
      const kid = kids.find(k => k.id === s.kidId);
      return `<div class="custom-feed-row">
          <span class="custom-feed-label">${esc(s.customName || 'Custom calendar')}${s.deadline ? ' <span class="school-feed-deadline-tag">deadlines</span>' : ''}</span>
          <span class="custom-feed-kid" style="color:${kid ? kid.color : '#6C63FF'}">${kid ? esc(kid.name) : ''}</span>
          <button type="button" class="kid-row-remove" title="Remove" onclick="handleRemoveCustomFeed('${s.id}')">×</button>
        </div>`;
    }).join('');
  }

  el.innerHTML = html;

  if (schoolSyncErrors.length) {
    const errEl = document.getElementById('school-sync-errors');
    if (errEl) {
      errEl.style.display = '';
      errEl.innerHTML = '⚠️ Couldn\'t sync: ' + schoolSyncErrors.map(e => `<strong>${esc(e.label)}</strong> (${esc(e.error)})`).join(', ');
    }
  } else {
    const errEl = document.getElementById('school-sync-errors');
    if (errEl) errEl.style.display = 'none';
  }
}

async function handleToggleBuiltinFeed(kidId, feedId, checked) {
  try {
    if (checked) {
      await window.auth.subscribeCalendarFeed({ kidId, feedId });
    } else {
      await window.auth.unsubscribeCalendarFeed({ kidId, feedId });
    }
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, silent: true });
    toast(checked ? 'Subscribed! Syncing… 🎓' : 'Unsubscribed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
    renderSchoolSettings(); // revert the checkbox to actual state
  }
}

async function handleRemoveCustomFeed(subscriptionId) {
  try {
    await window.auth.unsubscribeCalendarFeed({ subscriptionId });
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, silent: true });
    toast('Calendar removed.');
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

/* ---------- Add your school's calendar (custom URL, guided flow) ---------- */
let customFeedPreview = null; // { normalizedUrl, calendarName, count, sampleTitles } from the last successful preview

function openAddSchoolCalendarModal() {
  customFeedPreview = null;
  document.getElementById('custom-feed-url').value = '';
  document.getElementById('custom-feed-name').value = '';
  document.getElementById('custom-feed-preview-result').style.display = 'none';
  document.getElementById('custom-feed-preview-result').innerHTML = '';
  document.getElementById('custom-feed-confirm-section').style.display = 'none';
  document.getElementById('custom-feed-error').textContent = '';
  const kids = (currentFamily && currentFamily.kids) || [];
  const kidSelect = document.getElementById('custom-feed-kid');
  kidSelect.innerHTML = kids.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">No kids yet</option>';
  openModal('add-school-calendar-modal');
}

async function handlePreviewCustomFeed() {
  const url = document.getElementById('custom-feed-url').value.trim();
  const errEl = document.getElementById('custom-feed-error');
  const resultEl = document.getElementById('custom-feed-preview-result');
  const confirmEl = document.getElementById('custom-feed-confirm-section');
  errEl.textContent = '';
  resultEl.style.display = 'none';
  confirmEl.style.display = 'none';
  customFeedPreview = null;
  if (!url) { errEl.textContent = 'Paste a calendar link first.'; return; }

  const btn = document.getElementById('custom-feed-preview-btn');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const preview = await window.auth.previewCalendarFeed(url);
    customFeedPreview = preview;
    const nameLine = preview.calendarName ? `Found <strong>${esc(preview.calendarName)}</strong> — ` : 'Found ';
    resultEl.innerHTML = `✅ ${nameLine}${preview.count} event${preview.count === 1 ? '' : 's'}.` +
      (preview.sampleTitles && preview.sampleTitles.length
        ? `<div class="text-muted" style="margin-top:6px">e.g. ${preview.sampleTitles.map(t => `“${esc(t)}”`).join(', ')}</div>`
        : '');
    resultEl.style.display = '';
    document.getElementById('custom-feed-name').value = preview.calendarName || '';
    confirmEl.style.display = '';
  } catch (err) {
    errEl.textContent = err.message || 'Could not check that calendar.';
  } finally {
    btn.disabled = false; btn.textContent = 'Check this link';
  }
}

async function handleSaveCustomFeed(e) {
  e.preventDefault();
  const errEl = document.getElementById('custom-feed-error');
  if (!customFeedPreview || !customFeedPreview.ok) {
    errEl.textContent = 'Check the link first so we know it works.';
    return;
  }
  const kidId = document.getElementById('custom-feed-kid').value;
  const customName = document.getElementById('custom-feed-name').value.trim();
  if (!kidId) { errEl.textContent = 'Add a kid profile first, then pick who this calendar is for.'; return; }
  try {
    await window.auth.subscribeCalendarFeed({
      kidId,
      customUrl: customFeedPreview.normalizedUrl,
      customName: customName || customFeedPreview.calendarName || 'School calendar',
    });
    closeModal('add-school-calendar-modal');
    await loadSchoolFeedsInfo();
    renderSchoolSettings();
    await syncSchoolCalendar({ force: true, showToast: true });
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function switchFeedGuideTab(tab) {
  document.querySelectorAll('.feed-guide-tab').forEach(t => t.classList.toggle('active', t.dataset.guide === tab));
  document.querySelectorAll('.feed-guide-panel').forEach(p => p.classList.toggle('active', p.id === `guide-${tab}`));
}

/* ============================================================
   EVENTS — ADD / VIEW / DELETE
============================================================ */
function openAddEventModal(ds) {
  pendingDate = ds || null;
  document.getElementById('event-title').value   = '';
  document.getElementById('event-date').value    = ds || isoDate(new Date());
  document.getElementById('event-time').value    = '';
  document.getElementById('event-end-time').value= '';
  document.getElementById('event-notes').value   = '';
  document.querySelector('input[name="cat"][value="school"]').checked = true;
  openModal('add-event-modal');
}

function saveEvent(e) {
  e.preventDefault();
  const events = getEvents();
  const ev = {
    id:       uid(),
    userId:   sessionUser.id,
    kidId:    activeKidId || null,
    title:    document.getElementById('event-title').value.trim(),
    date:     document.getElementById('event-date').value,
    time:     document.getElementById('event-time').value,
    endTime:  document.getElementById('event-end-time').value,
    category: document.querySelector('input[name="cat"]:checked').value,
    notes:    document.getElementById('event-notes').value.trim(),
  };
  events.push(ev);
  saveEvents(events);
  announceEventToChat(ev);
  closeModal('add-event-modal');
  renderCalendar();
  renderMiniCal();
  scheduleReminders();
  toast('Event added! 🎯');
}

// A manually-added calendar event lives only in this device's localStorage
// (fam_events). The shared family chat is the one server-synced surface
// everyone sees, so we post the new event there to notify the group. Bulk
// imports (school feeds, timetable) call saveEvents() directly and deliberately
// skip this, so they never flood the chat. Fire-and-forget: the event is
// already saved, so a chat hiccup must not block the add or throw on the
// calendar flow.
function announceEventToChat(ev) {
  if (!ev || !ev.title) return;
  if (!window.auth || typeof window.auth.sendChatMessage !== 'function') return;
  try {
    const catIcon = { school: '🏫', sports: '⚽', arts: '🎨', social: '👫', other: '⭐' };
    const when = ev.time
      ? `${formatLong(parseIso(ev.date))} at ${fmt12(ev.time)}`
      : `${formatLong(parseIso(ev.date))} (all day)`;
    const kidName = ev.kidId ? kidNameFor(ev.kidId) : '';
    const forWho = kidName ? ` for ${kidName}` : '';
    const text = `📅 New event${forWho}: ${catIcon[ev.category] || '📌'} ${ev.title} — ${when}`;
    Promise.resolve(window.auth.sendChatMessage(text)).catch(() => {});
  } catch (_) { /* never let the announcement break adding an event */ }
}

function showDetail(id) {
  // School events live in server state (schoolEvents), not localStorage —
  // look there first via the normalized id shape ('school-<subId>-<uid>').
  const ev = String(id).startsWith('school-')
    ? visibleEvents().find(e => e.id === id)
    : getEvents().find(e => e.id === id);
  if (!ev) return;
  activeEventId = id;

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

  // School events are read-only (synced from the school's calendar) — hide
  // delete and show a lock hint instead. Any signed-in parent can delete a
  // manual event (parent-only app — see APP-BRIEF.md).
  const deleteBtn = document.getElementById('btn-delete-event');
  const lockHint = document.getElementById('detail-readonly-hint');
  if (ev.source === 'school') {
    deleteBtn.style.display = 'none';
    if (lockHint) {
      lockHint.style.display = '';
      lockHint.textContent = `🔒 Synced from ${ev.feedLabel || 'the school calendar'} — read-only.` + (ev.recurring ? ' Repeats — showing the next occurrence.' : '');
    }
  } else {
    deleteBtn.style.display = '';
    if (lockHint) lockHint.style.display = 'none';
  }

  openModal('event-detail-modal');
}

function deleteCurrentEvent() {
  if (!activeEventId || String(activeEventId).startsWith('school-')) return;
  saveEvents(getEvents().filter(e => e.id !== activeEventId));
  closeModal('event-detail-modal');
  renderCalendar();
  renderMiniCal();
  toast('Event deleted.');
  activeEventId = null;
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
      content.innerHTML = `<div style="padding:16px;color:var(--text-muted)">Preview not available for this file type.</div>`;
    }
    document.getElementById('upload-preview').style.display = '';
    uploadedFile._dataUrl = ev.target.result;

    // Auto-parse if API key is configured.
    // TODO(security): this still calls the Anthropic API directly from the
    // browser with a client-exposed key (config.js / ANTHROPIC_API_KEY) —
    // known FEATURE_PLAN.md Phase 1 security-hygiene item ("move the
    // Anthropic key behind a serverless proxy"). Not fixed as part of this
    // migration; flagging per migration instructions.
    if (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) {
      document.getElementById('ai-parse-section').style.display = '';
      setParseStatus('⏳', 'Parsing schedule with AI…');
      parseScheduleWithAI();
    }
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

  // Fact
  const f = dailyPick(FACTS, now);
  document.getElementById('fact-icon').textContent  = f.icon;
  document.getElementById('fact-label').textContent = `${f.type} Fact`;
  document.getElementById('fact-text').textContent  = f.text;

  // News
  const n = dailyPick(NEWS_ITEMS, now);
  currentNews = n;
  document.getElementById('news-badge').textContent    = n.cat;
  document.getElementById('news-headline').textContent = n.headline;
  document.getElementById('news-summary').textContent  = n.summary;
  document.getElementById('news-reflect-prompt').textContent = 'Why do you think this matters, and how does it make you feel?';
  document.getElementById('news-reflect-text').value = '';

  // Mood check-in
  renderMoodWidget();

  // Brain teaser (server-backed, day-ramped)
  loadBrainTeaser();

  applyEnrichmentGating();
}

/* ============================================================
   SCHOOL STATS WIDGET (house points / attendance / canteen)
   Parent-only (mirrors the Moodle IDs Settings card gating). Reads
   famGetSchoolStats() — purely local, populated by the extension's
   famImportSchoolData bridge calls (see PART B above). Respects the kid
   switcher (activeKidId) when one is selected, else shows every kid with
   stored stats.
============================================================ */
function renderSchoolStatsWidget() {
  const widget = document.getElementById('widget-school-stats');
  const rowsEl = document.getElementById('school-stats-rows');
  if (!widget || !rowsEl) return;

  if (isKidSession() || !currentFamily) {
    widget.style.display = 'none';
    return;
  }

  const stats = famGetSchoolStats();
  const kids = (currentFamily.kids || []).filter((k) => stats[k.id]);
  const visible = activeKidId ? kids.filter((k) => k.id === activeKidId) : kids;

  if (!visible.length) {
    widget.style.display = 'none';
    return;
  }

  widget.style.display = '';
  rowsEl.innerHTML = visible.map((k) => {
    const s = stats[k.id] || {};
    const points = (s.housePoints === null || s.housePoints === undefined) ? '—' : s.housePoints;
    const attend = (s.attendance === null || s.attendance === undefined) ? '—' : `${s.attendance}%`;
    const punctual = (s.punctual === null || s.punctual === undefined) ? '' : ` (${s.punctual}% on time)`;
    const hasBalance = s.canteenBalance !== null && s.canteenBalance !== undefined;
    const lowBalance = hasBalance && s.canteenBalance < LOW_BALANCE_THRESHOLD;
    const balance = hasBalance ? `฿${s.canteenBalance}` : '—';
    return `<div class="school-stats-row">
      <span class="school-stats-swatch" style="background:${k.color || '#ccc'}"></span>
      <span class="school-stats-name">${esc(k.name)}</span>
      <span class="school-stats-metric" title="House points">🏆 ${points}</span>
      <span class="school-stats-metric" title="Attendance (punctuality)">✅ ${attend}${esc(punctual)}</span>
      <span class="school-stats-metric school-stats-balance${lowBalance ? ' low' : ''}" title="Canteen balance">🍽️ ${balance}</span>
    </div>`;
  }).join('');
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
  }
}

/* ============================================================
   STREAK
============================================================ */
function renderStreak() {
  const key    = `fam_streak_${sessionUser.id}`;
  const streak = load(key) || { count: 0, last: '' };
  document.getElementById('streak-count').textContent = streak.count;
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
  document.getElementById('streak-count').textContent = streak.count;
}

/* ============================================================
   AI SCHEDULE PARSING
   TODO(security): parseScheduleWithAI() below calls the Anthropic API
   directly from the browser using a client-exposed key. This matches a
   known FEATURE_PLAN.md Phase 1 item ("move the Anthropic key behind a
   serverless proxy") — flagged, not fixed, in this migration.
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
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
  const apiKey = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) ? ANTHROPIC_API_KEY : '';
  if (!apiKey) {
    setParseStatus('⚠️', 'No API key configured in config.js');
    return;
  }

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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':                              apiKey,
        'anthropic-version':                      '2023-06-01',
        'content-type':                           'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text',  text: `Parse this school timetable image into a JSON array.
Each element must have exactly these fields:
{
  "day": one of "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
  "subject": "subject or class name",
  "teacher": "teacher name or empty string",
  "room": "room/location or empty string",
  "startTime": "HH:MM in 24-hour format",
  "endTime": "HH:MM in 24-hour format (estimate from next period if not shown)"
}
Rules:
- Skip registration/form periods unless they have a distinct subject.
- Derive endTime from the next period's startTime if not explicitly shown.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.` }
          ]
        }]
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data   = await res.json();
    let   rawText = data.content?.[0]?.text?.trim() || '';

    // Strip markdown code fences if present
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) rawText = fenceMatch[1].trim();

    const events = JSON.parse(rawText);
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
function kidColorFor(kidProfileId) {
  const kids = (currentFamily && currentFamily.kids) || [];
  const k = kids.find((x) => x.id === kidProfileId);
  return k ? k.color : null;
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
    const color = m.senderType === 'kid' ? (kidColorFor(m.senderId) || 'var(--primary)') : 'var(--primary)';
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
}

async function loadChatMessages() {
  try {
    const msgs = await window.auth.getMessages();
    chatMessages = msgs;
    chatLastAt = msgs.length ? msgs[msgs.length - 1].createdAt : null;
    renderChatMessages();
    scrollChatToBottom(); // always land on the latest message when (re)loading
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function pollChatMessages() {
  try {
    const msgs = await window.auth.getMessages(chatLastAt);
    if (msgs.length) {
      // Merge by id: a poll can return an update to an already-seen message
      // (e.g. deleted/flagged in place), not just brand-new ones.
      const byId = new Map(chatMessages.map((m) => [m.id, m]));
      for (const m of msgs) byId.set(m.id, m);
      chatMessages = Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      chatLastAt = chatMessages[chatMessages.length - 1].createdAt;
      renderChatMessages();
    }
  } catch (err) { /* transient poll failures shouldn't spam toasts */ }
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(pollChatMessages, CHAT_POLL_MS);
  setupChatRealtimeNudges();
}

function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}

// Instant-refresh triggers so a new message renders with ~no lag instead of
// waiting for the poll tick: (a) the service worker posts 'fam-push' the moment
// a chat push arrives; (b) the tab regaining focus/visibility. Both only poll
// while chat is actually active (chatPollTimer set). Registered once.
let chatNudgesReady = false;
function setupChatRealtimeNudges() {
  if (chatNudgesReady) return;
  chatNudgesReady = true;
  const nudge = () => { if (chatPollTimer) pollChatMessages(); };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'fam-push') nudge();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nudge(); });
  window.addEventListener('focus', nudge);
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

  const groups = groupHomeworkByDueDate(items);
  const sections = [
    ['overdue', '🔴 Overdue'],
    ['today', '🟡 Today'],
    ['thisWeek', '📅 This week'],
    ['later', '🗓️ Later'],
  ];

  list.innerHTML = sections
    .filter(([key]) => groups[key].length)
    .map(([key, label]) => `
      <div class="homework-group">
        <h4 class="homework-group-title">${label} <span class="homework-group-count">${groups[key].length}</span></h4>
        <div class="homework-group-items">
          ${groups[key].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(renderHomeworkRow).join('')}
        </div>
      </div>
    `).join('');
}

function renderHomeworkRow(item) {
  const done = item.status === 'done';
  const checklistDone = (item.checklist || []).filter((c) => c.done).length;
  const checklistTotal = (item.checklist || []).length;
  const kidLabel = (!isKidSession() && !activeKidId) ? `<span class="hw-kid-tag">${esc(kidNameFor(item.kidId))}</span>` : '';
  return `
    <div class="homework-row${done ? ' hw-done' : ''}" data-hw-id="${item.id}">
      <button class="hw-check${done ? ' checked' : ''}" onclick="event.stopPropagation();toggleHomeworkDone('${item.id}')" title="${done ? 'Mark as not done' : 'Mark as done'}" aria-label="Toggle done">${done ? '✓' : ''}</button>
      <div class="hw-row-main" onclick="openHomeworkDetail('${item.id}')">
        <div class="hw-row-title-line">
          ${homeworkSourceBadge(item.source)}
          <span class="hw-row-title">${esc(item.title)}</span>
          ${kidLabel}
        </div>
        <div class="hw-row-meta">
          ${item.subject ? `<span class="hw-chip hw-subject-chip">${esc(item.subject)}</span>` : ''}
          <span class="hw-chip hw-status-chip hw-status-${item.status}">${item.status === 'in_progress' ? 'In progress' : (item.status === 'done' ? 'Done' : 'To do')}</span>
          <span class="hw-due-label">${formatShort(parseIso(item.dueDate))}${item.dueTime ? ' · ' + fmt12(item.dueTime) : ''}</span>
          ${checklistTotal ? `<span class="hw-checklist-progress">${checklistDone}/${checklistTotal} steps</span>` : ''}
        </div>
      </div>
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
   SCHOOL ACCOUNT (Moodle) IMPORT — parent-only.
   Modal flow: connect credentials -> map kid to Moodle user id -> Import
   (server returns a PREVIEW, nothing saved yet) -> "Add to Fam ETC" confirms.
   Homework confirms into the server-side homework hub (see loadHomework()).
   Timetable rows come back from the preview/confirm response and are added
   here as normal calendar events (localStorage `fam_events`, same shape as
   saveEvent() above: {id,userId,kidId,title,date,time,endTime,category,notes})
   tagged category:'school' and kidId — see confirmTimetableAsEvents().
============================================================ */
let schoolStatusCache = null;      // last GET /api/school/status result
let schoolImportPreview = null;    // { homework:[...], timetable:[...] } from POST /api/school/import

function showSchoolStep(step) {
  const steps = { connect: 'school-step-connect', connected: 'school-step-connected', preview: 'school-step-preview' };
  Object.values(steps).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(steps[step]);
  if (target) target.style.display = '';
}

async function openSchoolAccountModal() {
  document.getElementById('school-connect-error').textContent = '';
  document.getElementById('school-import-error').textContent = '';
  document.getElementById('school-preview-error').textContent = '';
  document.getElementById('school-username').value = '';
  document.getElementById('school-password').value = '';
  openModal('school-account-modal');
  try {
    schoolStatusCache = await window.auth.getSchoolStatus();
  } catch (e) {
    schoolStatusCache = null;
  }
  if (!schoolStatusCache || !schoolStatusCache.encryptionAvailable) {
    showSchoolStep('connect');
    document.getElementById('school-connect-error').textContent = schoolStatusCache
      ? 'School account connection is not available on this server yet.'
      : 'Could not check school account status. Please try again.';
    document.getElementById('school-connect-submit-btn').disabled = true;
    return;
  }
  document.getElementById('school-connect-submit-btn').disabled = false;
  if (schoolStatusCache.connected) {
    showSchoolStep('connected');
    populateSchoolImportKidSelect();
  } else {
    showSchoolStep('connect');
  }
}

async function handleConnectSchoolAccount(e) {
  e.preventDefault();
  const errEl = document.getElementById('school-connect-error');
  errEl.textContent = '';
  const username = document.getElementById('school-username').value.trim();
  const password = document.getElementById('school-password').value;
  const btn = document.getElementById('school-connect-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await window.auth.connectSchoolAccount(username, password);
    document.getElementById('school-password').value = ''; // never keep it in the DOM longer than needed
    toast('School account connected! 🔗');
    schoolStatusCache = await window.auth.getSchoolStatus();
    showSchoolStep('connected');
    populateSchoolImportKidSelect();
  } catch (err) {
    errEl.textContent = err.message || 'Could not connect. Please check your username and password.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect 🔗';
  }
}

function populateSchoolImportKidSelect() {
  const sel = document.getElementById('school-import-kid');
  const kids = (currentFamily && currentFamily.kids) || [];
  sel.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">No kids yet</option>';
  renderSchoolKidMapping();
}

function renderSchoolKidMapping() {
  const kidId = document.getElementById('school-import-kid').value;
  const mapping = (schoolStatusCache && schoolStatusCache.kidMappings || []).find((m) => m.kidId === kidId);
  document.getElementById('school-moodle-userid').value = mapping ? mapping.moodleUserId : '';
}

async function handleImportSchoolData() {
  const errEl = document.getElementById('school-import-error');
  errEl.textContent = '';
  const kidId = document.getElementById('school-import-kid').value;
  const moodleUserId = document.getElementById('school-moodle-userid').value.trim();
  if (!kidId) { errEl.textContent = 'Add a kid profile first.'; return; }
  if (!/^\d+$/.test(moodleUserId)) { errEl.textContent = 'Enter a numeric Moodle user id.'; return; }

  const btn = document.getElementById('school-import-btn-2');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    await window.auth.mapSchoolKid(kidId, moodleUserId);
    schoolImportPreview = await window.auth.importSchoolData(kidId);
    schoolImportPreview.kidId = kidId;
    renderSchoolPreview();
    showSchoolStep('preview');
  } catch (err) {
    errEl.textContent = err.message || 'Could not import from the school portal.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import 📥';
  }
}

function renderSchoolPreview() {
  const hwEl = document.getElementById('school-preview-homework');
  const ttEl = document.getElementById('school-preview-timetable');
  const hw = (schoolImportPreview && schoolImportPreview.homework) || [];
  const tt = (schoolImportPreview && schoolImportPreview.timetable) || [];

  const pending = hw.filter((h) => !h.completed);
  hwEl.innerHTML = pending.length
    ? pending.map((h) => `
        <div class="homework-row">
          <div class="hw-row-main">
            <div class="hw-row-title-line"><span class="hw-row-title">${esc(h.title)}</span></div>
            <div class="hw-row-meta">
              ${h.subject ? `<span class="hw-chip hw-subject-chip">${esc(h.subject)}</span>` : ''}
              <span class="hw-due-label">${esc(h.dueDate || 'No date')}</span>
            </div>
          </div>
        </div>`).join('')
    : '<p class="text-muted">No pending homework found.</p>';
  const skipped = hw.length - pending.length;
  if (skipped > 0) {
    hwEl.innerHTML += `<p class="text-muted">${skipped} completed item${skipped === 1 ? '' : 's'} not imported.</p>`;
  }

  ttEl.innerHTML = tt.length
    ? tt.map((t) => `<div class="homework-row"><div class="hw-row-main"><div class="hw-row-title-line"><span class="hw-row-title">${esc(t.day)} ${esc(t.time || '')} — ${esc(t.subject)}</span></div></div></div>`).join('')
    : '<p class="text-muted">No timetable found.</p>';
}

async function handleConfirmSchoolImport() {
  const errEl = document.getElementById('school-preview-error');
  errEl.textContent = '';
  if (!schoolImportPreview) return;
  try {
    const result = await window.auth.confirmSchoolImport(schoolImportPreview.kidId, schoolImportPreview.homework, schoolImportPreview.timetable);
    confirmTimetableAsEvents(result.timetable || [], schoolImportPreview.kidId);
    await loadHomework();
    renderHomeworkHub();
    renderCalendar();
    renderMiniCal();
    closeModal('school-account-modal');
    toast(`Imported ${result.homeworkCreated} homework item${result.homeworkCreated === 1 ? '' : 's'} 🎓`);
  } catch (err) {
    errEl.textContent = err.message || 'Could not save the import.';
  }
}

// Adds imported timetable rows as normal calendar events, same shape as
// saveEvent() — tagged category:'school' and the imported kidId. Dedups
// against existing events by title+date+time+kidId so re-importing the same
// week doesn't create duplicates.
function confirmTimetableAsEvents(timetableRows, kidId) {
  if (!timetableRows.length) return;
  const events = getEvents();
  const todayIso = isoDate(new Date());
  const dowIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const base = new Date();
  let added = 0;
  timetableRows.forEach((row) => {
    const dow = dowIndex[String(row.day || '').toLowerCase()];
    let dateStr = todayIso;
    if (dow !== undefined) {
      const d = new Date(base);
      const diff = (dow - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
      dateStr = isoDate(d);
    }
    const title = row.subject || row.period || 'Class';
    const exists = events.some((e) => e.kidId === kidId && e.title === title && e.date === dateStr && e.time === (row.time || ''));
    if (exists) return;
    events.push({
      id: uid(),
      userId: sessionUser.id,
      kidId,
      title,
      date: dateStr,
      time: row.time || '',
      endTime: '',
      category: 'school',
      notes: [row.teacher, row.room].filter(Boolean).join(' · '),
    });
    added++;
  });
  if (added) saveEvents(events);
}

async function handleDisconnectSchoolAccount() {
  try {
    await window.auth.disconnectSchoolAccount();
    schoolStatusCache = null;
    schoolImportPreview = null;
    toast('School account disconnected.');
    showSchoolStep('connect');
    document.getElementById('school-username').value = '';
    document.getElementById('school-password').value = '';
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

/* ---------- Snap homework (AI parse from a photo) ----------
   Reuses the SAME photo-upload + Claude parse pipeline as
   parseScheduleWithAI()/processUpload() (see the AI PARSE section above),
   adapted to extract homework items (subject, title, due date) instead of
   class periods. Parent reviews+edits before saving as source:"ai".
   TODO(security): same client-exposed Anthropic key as parseScheduleWithAI()
   — tracked Phase 1 item, not fixed here (see that function's TODO). */
let hwUploadedFile = null;
let parsedHomeworkItems = [];

function openSnapHomeworkModal() {
  clearHomeworkUpload();
  openModal('snap-homework-modal');
}

function handleHomeworkDrop(e) {
  e.preventDefault();
  document.getElementById('hw-upload-zone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processHomeworkUpload(file);
}

function handleHomeworkFileSelect(e) {
  const file = e.target.files[0];
  if (file) processHomeworkUpload(file);
}

function processHomeworkUpload(file) {
  hwUploadedFile = file;
  document.getElementById('hw-preview-filename').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = document.getElementById('hw-preview-content');
    if (file.type.startsWith('image/')) {
      content.innerHTML = `<img src="${ev.target.result}" alt="Homework diary preview">`;
    } else if (file.type === 'application/pdf') {
      content.innerHTML = `<iframe src="${ev.target.result}" title="Homework diary PDF"></iframe>`;
    } else {
      content.innerHTML = `<div style="padding:16px;color:var(--text-muted)">Preview not available for this file type.</div>`;
    }
    document.getElementById('hw-upload-preview').style.display = '';
    hwUploadedFile._dataUrl = ev.target.result;

    if (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) {
      document.getElementById('hw-ai-parse-section').style.display = '';
      setHomeworkParseStatus('⏳', 'Parsing homework diary with AI…');
      parseHomeworkWithAI();
    } else {
      setHomeworkParseStatus('⚠️', 'No API key configured in config.js');
      document.getElementById('hw-ai-parse-section').style.display = '';
    }
  };
  reader.readAsDataURL(file);
}

function clearHomeworkUpload() {
  hwUploadedFile = null;
  document.getElementById('hw-upload-preview').style.display = 'none';
  document.getElementById('hw-preview-content').innerHTML = '';
  document.getElementById('hw-file-input').value = '';
  document.getElementById('hw-ai-parse-section').style.display = 'none';
}

function setHomeworkParseStatus(icon, text) {
  const spinner = document.getElementById('hw-ai-spinner');
  const label = document.getElementById('hw-ai-status-text');
  if (spinner) spinner.textContent = icon;
  if (label) label.textContent = text;
}

async function parseHomeworkWithAI() {
  const apiKey = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY) ? ANTHROPIC_API_KEY : '';
  if (!apiKey) { setHomeworkParseStatus('⚠️', 'No API key configured in config.js'); return; }

  try {
    let base64, mediaType;
    if (hwUploadedFile.type === 'application/pdf') {
      const result = await renderPdfToBase64(hwUploadedFile);
      base64 = result.base64;
      mediaType = result.mediaType;
    } else {
      const dataUrl = hwUploadedFile._dataUrl;
      base64 = dataUrl.split(',')[1];
      mediaType = dataUrl.split(',')[0].match(/:(.*?);/)[1];
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
        throw new Error('Unsupported image type. Please use JPG or PNG.');
      }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `Parse this photo of a homework diary/planner page into a JSON array of homework items.
Each element must have exactly these fields:
{
  "subject": "subject or class name",
  "title": "short description of the homework/assignment",
  "dueDate": "YYYY-MM-DD — infer the year from context if not shown; use today's date ${isoDate(new Date())} as a reference point for 'this Friday' etc. style phrasing"
}
Rules:
- One entry per homework/assignment item, even if several are for the same subject.
- If no due date is visible for an item, make your best guess based on context (e.g. tomorrow) rather than omitting it.
- Return ONLY a valid JSON array with no markdown, no code blocks, no extra text.` },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    let rawText = data.content?.[0]?.text?.trim() || '';
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) rawText = fenceMatch[1].trim();

    const items = JSON.parse(rawText);
    if (!Array.isArray(items) || items.length === 0) throw new Error('No homework items found in the photo.');

    setHomeworkParseStatus('✅', `Found ${items.length} item(s) — review below`);
    openHomeworkParseReview(items);
  } catch (err) {
    setHomeworkParseStatus('❌', `Parse failed: ${err.message}`);
    toast(`❌ ${err.message}`);
    console.error(err);
  }
}

function openHomeworkParseReview(items) {
  parsedHomeworkItems = items;
  closeModal('snap-homework-modal');

  const kidGroup = document.getElementById('hw-parse-kid-group');
  const kidSelect = document.getElementById('hw-parse-kid');
  if (isKidSession()) {
    kidGroup.style.display = 'none';
  } else {
    kidGroup.style.display = '';
    const kids = (currentFamily && currentFamily.kids) || [];
    kidSelect.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('') || '<option value="">Add a kid first</option>';
    if (activeKidId) kidSelect.value = activeKidId;
  }

  renderHomeworkParseTable(items);
  updateHomeworkParseSummary();
  openModal('snap-homework-review-modal');
}

function renderHomeworkParseTable(items) {
  const tbody = document.getElementById('hw-parse-tbody');
  tbody.innerHTML = items.map((it, i) => `
    <tr>
      <td><input type="checkbox" class="hw-parse-check" data-i="${i}" checked onchange="updateHomeworkParseSummary()"></td>
      <td><input type="text" value="${esc(it.subject || '')}" oninput="parsedHomeworkItems[${i}].subject=this.value"></td>
      <td><input type="text" value="${esc(it.title || '')}" oninput="parsedHomeworkItems[${i}].title=this.value"></td>
      <td><input type="date" value="${esc(it.dueDate || '')}" oninput="parsedHomeworkItems[${i}].dueDate=this.value"></td>
    </tr>`).join('');
}

function toggleAllHomeworkParsed(checked) {
  document.querySelectorAll('.hw-parse-check').forEach((cb) => { cb.checked = checked; });
  updateHomeworkParseSummary();
}

function updateHomeworkParseSummary() {
  const checked = document.querySelectorAll('.hw-parse-check:checked').length;
  const total = parsedHomeworkItems.length;
  const summary = document.getElementById('hw-parse-summary');
  if (summary) summary.textContent = `${checked} of ${total} item(s) selected`;
}

async function applyParsedHomework() {
  const kidId = isKidSession() ? sessionUser.kidId : document.getElementById('hw-parse-kid').value;
  if (!kidId) { toast('Add a kid profile first.'); return; }

  const rows = document.querySelectorAll('#hw-parse-tbody tr');
  const selected = [];
  rows.forEach((row, i) => {
    if (!row.querySelector('.hw-parse-check')?.checked) return;
    selected.push(parsedHomeworkItems[i]);
  });
  if (!selected.length) { toast('No items selected.'); return; }

  let added = 0;
  for (const it of selected) {
    if (!it.title || !it.dueDate) continue;
    try {
      const res = await window.auth.addHomework({
        kidId, title: it.title, subject: it.subject || '', dueDate: it.dueDate, source: 'ai',
      });
      homeworkItems.push(res.homework);
      added++;
    } catch (err) { /* skip individual failures, keep going */ }
  }

  closeModal('snap-homework-review-modal');
  renderHomeworkHub();
  renderCalendar();
  toast(`✅ Added ${added} homework item${added === 1 ? '' : 's'}!`);
}

/* ============================================================
   NAV TABS (Calendar[=Dashboard] / Homework / Goals / Activities / Settings)
   Chat is not a tab — it's a persistent part of the Calendar/dashboard panel
   (see index.html .dashboard-chat). Its poll lifecycle is tied to the
   dashboard tab being visible: polling starts when the user is on the
   dashboard and stops the moment they switch to any other tab, so it never
   polls needlessly in the background.
============================================================ */
function switchNavTab(tab) {
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
  });
  // Re-render dynamic panels each time they're opened so they reflect current state.
  if (tab === 'settings') { renderManageFamily(); renderSchoolSettings(); }
  if (tab === 'homework') { loadHomework().then(() => { renderHomeworkHub(); applyEnrichmentGating(); }); }
  if (tab === 'notes') { loadNotes(); }
  if (tab === 'calendar') {
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

// Reachable via postMessage too, so the extension can inject a tiny script
// that posts to the tab instead of calling the function directly (both
// paths are supported; executeScript-into-tab calling the function directly
// is the primary path — see chrome-extension/popup.js).
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'fam-etc-school-import') return;
  famImportSchoolData(event.data.payload || {}).then((result) => {
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage({ type: 'fam-etc-school-import-result', result }, event.origin);
    }
  });
});

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
