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
const CHAT_POLL_MS  = 4000;

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
}

function renderManageFamily() {
  applyRoleScopingToUI();
  // Kid sessions never render family-management controls at all — the
  // parent-only container is hidden by applyRoleScopingToUI(), and the
  // backend independently rejects any parent-only call a kid might still
  // trigger (e.g. via devtools), so this is defense in depth, not the gate.
  if (isKidSession()) return;

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
    if (count >= max) {
      inviteEl.innerHTML = `<p class="text-muted">Both parents are set up. 🎉</p>`;
    } else {
      const code = esc(currentFamily.inviteCode || '');
      inviteEl.innerHTML =
        `<div class="invite-box">
          <p style="margin:0 0 6px;font-weight:700">Invite the other parent</p>
          <p class="text-muted" style="margin:0 0 12px">
            Ask them to sign up at <strong>fametc.com</strong> and enter this family code.
            They'll get their own passkey on their own device.
          </p>
          <div class="invite-code-row">
            <code id="invite-code-value" class="invite-code">${code}</code>
            <button type="button" class="btn-secondary" onclick="copyInviteCode()">Copy code</button>
          </div>
        </div>`;
    }
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
        <button class="kid-row-device" onclick="handleProvisionKidDevice('${k.id}','${esc(k.name).replace(/'/g,"\\'")}')" title="Set up this device for ${esc(k.name)}">📱 Set up this device</button>
        <button class="kid-row-remove" onclick="handleRemoveKid('${k.id}')" title="Remove kid">×</button>
      </div>`
    ).join('') || '<p class="text-muted">No kids added yet.</p>';
  }
}

/* Parent-provisioned kid device passkey — run on the KID's device while the
   PARENT is signed in on it (Settings > Kids). Never touches the parent's
   own session. See APP-BRIEF.md "Kid sign-in". */
async function handleProvisionKidDevice(kidId, kidName) {
  if (!window.PublicKeyCredential) {
    toast('❌ Passkeys are not supported in this browser.');
    return;
  }
  try {
    await window.auth.provisionKidDevice(kidId);
    toast(`${kidName || 'Kid'}'s device is set up! They can now sign in here with Face ID / Touch ID. 🎉`);
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

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
  const evDates = new Set(getEvents().map(e => e.date));
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

function visibleEvents() {
  const events = getEvents();
  if (!activeKidId) return events;
  return events.filter(e => e.kidId === activeKidId);
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
    html += `<div class="week-day-col${isT?' is-today':''}${isW?' is-weekend':''}">
      <div class="week-day-col-hdr">
        <div class="wday-name">${days[i]}</div>
        <div class="wday-num">${d.getDate()}</div>
      </div>
      <div class="week-day-events">
        ${evs.map(ev => `
          <div class="week-evt c-${ev.category}" onclick="showDetail('${ev.id}')">
            ${ev.time ? `<span class="evt-time">${fmt12(ev.time)}</span>` : ''}
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
    html += `<div class="month-day${isT?' is-today':''}" onclick="openAddEventModal('${ds}')">
      <span class="mday-num">${isT ? `<span>${day}</span>` : day}</span>
      ${evs.slice(0,3).map(ev =>
        `<span class="month-evt chip-${ev.category}" onclick="event.stopPropagation();showDetail('${ev.id}')">${esc(ev.title)}</span>`
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
  events.push({
    id:       uid(),
    userId:   sessionUser.id,
    kidId:    activeKidId || null,
    title:    document.getElementById('event-title').value.trim(),
    date:     document.getElementById('event-date').value,
    time:     document.getElementById('event-time').value,
    endTime:  document.getElementById('event-end-time').value,
    category: document.querySelector('input[name="cat"]:checked').value,
    notes:    document.getElementById('event-notes').value.trim(),
  });
  saveEvents(events);
  closeModal('add-event-modal');
  renderCalendar();
  renderMiniCal();
  toast('Event added! 🎯');
}

function showDetail(id) {
  const ev = getEvents().find(e => e.id === id);
  if (!ev) return;
  activeEventId = id;

  const catLabel = { school:'🏫 School', sports:'⚽ Sports', arts:'🎨 Arts', social:'👫 Social', other:'⭐ Other' };
  const badge = document.getElementById('detail-badge');
  badge.textContent  = catLabel[ev.category] || ev.category;
  badge.className    = `detail-category-badge chip-${ev.category}`;

  document.getElementById('detail-title').textContent = ev.title;
  document.getElementById('detail-date').textContent  = formatLong(parseIso(ev.date));
  document.getElementById('detail-time').textContent  = ev.time
    ? `${fmt12(ev.time)}${ev.endTime ? ' – ' + fmt12(ev.endTime) : ''}`
    : 'All day';
  const notesRow = document.getElementById('detail-notes-row');
  if (ev.notes) {
    document.getElementById('detail-notes').textContent = ev.notes;
    notesRow.style.display = '';
  } else {
    notesRow.style.display = 'none';
  }

  // Any signed-in parent can delete (parent-only app — see APP-BRIEF.md).
  document.getElementById('btn-delete-event').style.display = '';

  openModal('event-detail-modal');
}

function deleteCurrentEvent() {
  if (!activeEventId) return;
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
  document.getElementById('quote-text').textContent   = q.text;
  document.getElementById('quote-author').textContent = `— ${q.author}`;

  // SAT Word
  const w = dailyPick(SAT_WORDS, now);
  document.getElementById('sat-word').textContent    = w.word;
  document.getElementById('sat-pos').textContent     = w.pos;
  document.getElementById('sat-def').textContent     = w.def;
  document.getElementById('sat-example').textContent = `"${w.example}"`;

  // Fact
  const f = dailyPick(FACTS, now);
  document.getElementById('fact-icon').textContent  = f.icon;
  document.getElementById('fact-label').textContent = `${f.type} Fact`;
  document.getElementById('fact-text').textContent  = f.text;

  // News
  const n = dailyPick(NEWS_ITEMS, now);
  document.getElementById('news-badge').textContent    = n.cat;
  document.getElementById('news-headline').textContent = n.headline;
  document.getElementById('news-summary').textContent  = n.summary;

  // Quiz
  const baseIdx = dayOfYear(now) % QUIZ.length;
  const offset  = load(`fam_qoffset_${sessionUser.id}`) || 0;
  quizIndex     = (baseIdx + offset) % QUIZ.length;
  renderQuiz();
}

/* ============================================================
   QUIZ
============================================================ */
function renderQuiz() {
  const q = QUIZ[quizIndex];
  document.getElementById('quiz-question').textContent = q.q;
  document.getElementById('quiz-options').innerHTML = q.opts.map((opt, i) =>
    `<button class="quiz-opt" onclick="answerQuiz(${i})">${esc(opt)}</button>`
  ).join('');
  document.getElementById('quiz-feedback').textContent = '';
  document.getElementById('quiz-feedback').className   = 'quiz-feedback';
  document.getElementById('btn-next-q').style.display  = 'none';
}

function answerQuiz(chosen) {
  const q    = QUIZ[quizIndex];
  const btns = document.querySelectorAll('.quiz-opt');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === chosen) btn.classList.add('wrong');
  });

  const fb = document.getElementById('quiz-feedback');
  if (chosen === q.ans) {
    fb.textContent = `✅ Correct! ${q.exp}`;
    fb.className   = 'quiz-feedback correct';
    incrementStreak();
  } else {
    fb.textContent = `❌ Not quite. ${q.exp}`;
    fb.className   = 'quiz-feedback wrong';
  }
  document.getElementById('btn-next-q').style.display = '';
}

function nextQuestion() {
  const key    = `fam_qoffset_${sessionUser.id}`;
  const offset = (load(key) || 0) + 1;
  save(key, offset);
  quizIndex = (quizIndex + 1) % QUIZ.length;
  renderQuiz();
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
    const controls = !isKidSession() ? `
      <div class="chat-msg-controls">
        <button class="chat-msg-ctrl" onclick="handleDeleteChatMessage('${m.id}')" title="Delete message">🗑️</button>
        <button class="chat-msg-ctrl" onclick="handleFlagChatMessage('${m.id}')" title="Report / flag message">🚩</button>
      </div>` : `
      <div class="chat-msg-controls">
        <button class="chat-msg-ctrl" onclick="handleFlagChatMessage('${m.id}')" title="Report / flag message">🚩</button>
      </div>`;
    return `<div class="chat-msg ${own ? 'chat-msg-own' : 'chat-msg-other'}">
      ${!own ? `<div class="chat-msg-sender" style="color:${color}">${esc(chatSenderName(m))}</div>` : ''}
      <div class="chat-msg-bubble" style="${own ? '' : `--sender-color:${color}`}">
        ${m.text ? `<div class="chat-msg-text">${esc(m.text)}</div>` : ''}
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
}

function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
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
  if (tab === 'settings') renderManageFamily();
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
   INIT
============================================================ */
async function init() {
  migrateLegacyStorage();
  const ok = await bootstrapSession();
  if (!ok) return; // redirected to /login
  showDashboard();
  registerServiceWorker().then(renderNotificationsControl);
}

document.addEventListener('DOMContentLoaded', init);
