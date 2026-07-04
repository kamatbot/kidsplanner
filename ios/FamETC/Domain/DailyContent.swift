import Foundation

// Daily rotating content for the Today dashboard widgets — ported verbatim from
// the web app (public/js/app.js QUOTES / SAT_WORDS / FACTS / NEWS_ITEMS / QUIZ)
// so iOS and web show the same "of the day" content. Picked deterministically by
// day-of-year, so it's stable through the day and needs no backend.

struct DailyQuote { let text: String; let author: String }
struct SATWord { let word: String; let pos: String; let def: String; let example: String }
struct FunFact { let icon: String; let type: String; let text: String }
struct NewsItem {
    let cat: String; let headline: String; let summary: String
    var url: String? = nil
    /// The article link. When an item has no explicit `url`, this opens a Google
    /// News search for the headline, which reliably surfaces real coverage of it.
    var articleLink: String {
        if let url, !url.isEmpty { return url }
        let q = headline.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return "https://news.google.com/search?q=\(q)"
    }
}
struct QuizQuestion { let q: String; let opts: [String]; let ans: Int; let exp: String }

enum Daily {
    static var dayOfYear: Int { Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 1 }
    static func index(_ count: Int) -> Int { count > 0 ? ((dayOfYear - 1) % count + count) % count : 0 }

    static var quote: DailyQuote { quotes[index(quotes.count)] }
    static var word: SATWord { words[index(words.count)] }
    static var fact: FunFact { facts[index(facts.count)] }
    static var news: NewsItem { newsItems[index(newsItems.count)] }
    static var quizStartIndex: Int { index(quiz.count) }

    static let quotes: [DailyQuote] = [
        .init(text: "The secret of getting ahead is getting started.", author: "Mark Twain"),
        .init(text: "Learning is not attained by chance; it must be sought for with ardor and diligence.", author: "Abigail Adams"),
        .init(text: "Education is the most powerful weapon you can use to change the world.", author: "Nelson Mandela"),
        .init(text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King"),
        .init(text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius"),
        .init(text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt"),
        .init(text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill"),
        .init(text: "The more that you read, the more things you will know.", author: "Dr. Seuss"),
        .init(text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis"),
        .init(text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison"),
        .init(text: "The only way to do great work is to love what you do.", author: "Steve Jobs"),
        .init(text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe"),
        .init(text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson"),
        .init(text: "The expert in anything was once a beginner.", author: "Helen Hayes"),
        .init(text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar"),
        .init(text: "Every accomplishment starts with the decision to try.", author: "Gail Devers"),
        .init(text: "Shoot for the moon. Even if you miss, you'll land among the stars.", author: "Les Brown"),
        .init(text: "Push yourself, because no one else is going to do it for you.", author: "Unknown"),
        .init(text: "Wake up with determination. Go to bed with satisfaction.", author: "Unknown"),
        .init(text: "Work hard in silence, let success make the noise.", author: "Frank Ocean"),
        .init(text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery"),
        .init(text: "Dream it. Wish it. Do it.", author: "Unknown"),
        .init(text: "In learning you will teach, and in teaching you will learn.", author: "Phil Collins"),
        .init(text: "The key to success is to focus on goals, not obstacles.", author: "Unknown"),
        .init(text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke"),
        .init(text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown"),
        .init(text: "Little by little, one travels far.", author: "J.R.R. Tolkien"),
        .init(text: "The mind is not a vessel to be filled, but a fire to be kindled.", author: "Plutarch"),
        .init(text: "Curiosity is the wick in the candle of learning.", author: "William Arthur Ward"),
        .init(text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin"),
    ]

    static let words: [SATWord] = [
        .init(word: "Eloquent", pos: "adjective", def: "Fluent or persuasive in speaking or writing.", example: "The eloquent speaker captivated the audience with her powerful words."),
        .init(word: "Persevere", pos: "verb", def: "Continue in a course of action despite difficulty or with little indication of success.", example: "She decided to persevere with her studies despite the many challenges."),
        .init(word: "Diligent", pos: "adjective", def: "Showing care and conscientiousness in one's work or duties.", example: "The diligent student always completed his homework before watching TV."),
        .init(word: "Benevolent", pos: "adjective", def: "Well-meaning and kindly; generous or charitable.", example: "The benevolent teacher stayed after class to help struggling students."),
        .init(word: "Tenacious", pos: "adjective", def: "Tending to keep a firm hold; persistent.", example: "The tenacious athlete practiced every day for three years to reach the Olympics."),
        .init(word: "Ambiguous", pos: "adjective", def: "Open to more than one interpretation; unclear.", example: "The teacher's ambiguous instructions confused many students in the class."),
        .init(word: "Candid", pos: "adjective", def: "Truthful and straightforward; frank.", example: "She gave a candid answer about why she didn't finish her homework."),
        .init(word: "Meticulous", pos: "adjective", def: "Showing great attention to detail; very careful and precise.", example: "The meticulous scientist checked each experiment three times before recording results."),
        .init(word: "Resilient", pos: "adjective", def: "Able to withstand or recover quickly from difficult conditions.", example: "Despite failing twice, the resilient student tried again and passed the exam."),
        .init(word: "Collaborate", pos: "verb", def: "Work jointly on an activity, especially to produce or create something.", example: "The students decided to collaborate on the science project to combine their strengths."),
        .init(word: "Empathy", pos: "noun", def: "The ability to understand and share the feelings of another.", example: "She showed great empathy when her friend was upset about not making the team."),
        .init(word: "Innovative", pos: "adjective", def: "Featuring new methods; advanced and original.", example: "The innovative inventor created a device that solved a common household problem."),
        .init(word: "Intrepid", pos: "adjective", def: "Fearless; adventurous.", example: "The intrepid explorer ventured deep into the jungle without hesitation."),
        .init(word: "Verbose", pos: "adjective", def: "Using more words than are needed.", example: "His verbose essay needed editing because the main point got lost in extra words."),
        .init(word: "Pragmatic", pos: "adjective", def: "Dealing with things sensibly and realistically based on practical considerations.", example: "The pragmatic student chose an essay topic she already knew well to save time."),
        .init(word: "Prolific", pos: "adjective", def: "Present in large numbers or quantities; highly productive.", example: "The prolific author wrote over 50 books during his lifetime."),
        .init(word: "Resolute", pos: "adjective", def: "Admirably purposeful, determined, and unwavering.", example: "She was resolute in her decision to become a doctor, despite the long years of study."),
        .init(word: "Skeptical", pos: "adjective", def: "Not easily convinced; having doubts or reservations.", example: "He was skeptical about the magic trick until he saw it performed three times."),
        .init(word: "Steadfast", pos: "adjective", def: "Resolutely firm and unwavering.", example: "She remained steadfast in her belief that hard work would lead to success."),
        .init(word: "Ubiquitous", pos: "adjective", def: "Present, appearing, or found everywhere.", example: "Smartphones have become ubiquitous in modern society."),
        .init(word: "Vivacious", pos: "adjective", def: "Attractively lively and animated.", example: "The vivacious student lit up every classroom discussion with her enthusiasm."),
        .init(word: "Zealous", pos: "adjective", def: "Having or showing great energy or enthusiasm in pursuit of a goal.", example: "The zealous volunteer spent every weekend helping at the animal shelter."),
        .init(word: "Adept", pos: "adjective", def: "Very skilled or proficient at something.", example: "After years of practice, she became adept at playing the violin."),
        .init(word: "Astute", pos: "adjective", def: "Having an ability to accurately assess situations and turn this to one's advantage.", example: "The astute student noticed the pattern in the math problem before others did."),
        .init(word: "Coherent", pos: "adjective", def: "Logical and consistent; forming a unified whole.", example: "A coherent essay has a clear introduction, body, and conclusion."),
        .init(word: "Enigmatic", pos: "adjective", def: "Difficult to interpret or understand; mysterious.", example: "The Mona Lisa's smile is considered enigmatic — no one can tell exactly what emotion it shows."),
        .init(word: "Transient", pos: "adjective", def: "Lasting only for a short time; impermanent.", example: "The snow was transient, melting by noon on the first day of spring."),
        .init(word: "Placid", pos: "adjective", def: "Not easily upset or excited; calm and peaceful.", example: "The placid lake reflected the mountains perfectly on the windless morning."),
        .init(word: "Credible", pos: "adjective", def: "Able to be believed; convincing.", example: "Use credible sources like encyclopedias and textbooks for your research paper."),
        .init(word: "Wary", pos: "adjective", def: "Feeling or showing caution about possible dangers or problems.", example: "Be wary of anyone who promises easy success without hard work."),
    ]

    static let facts: [FunFact] = [
        .init(icon: "🍯", type: "Science", text: "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible!"),
        .init(icon: "🌊", type: "Science", text: "Oceans cover about 71% of Earth's surface, yet more than 80% of the world's oceans remain unmapped and unexplored by humans."),
        .init(icon: "🦋", type: "Science", text: "A caterpillar dissolves almost completely into liquid inside its chrysalis before reorganizing into a butterfly — it rebuilds itself from scratch!"),
        .init(icon: "🏛️", type: "History", text: "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid. The pyramids are that ancient!"),
        .init(icon: "⚡", type: "Science", text: "Lightning strikes Earth about 100 times every second — that's 8 million lightning bolts per day!"),
        .init(icon: "🐙", type: "Science", text: "Octopuses have three hearts, blue blood, and can change the color and texture of their skin in less than a second."),
        .init(icon: "🌙", type: "Science", text: "The Moon is slowly drifting away from Earth at about 3.8 cm per year — the same rate your fingernails grow!"),
        .init(icon: "🦴", type: "Science", text: "You're born with about 270 bones, but by adulthood you have 206 because many fuse together as you grow."),
        .init(icon: "📜", type: "History", text: "In medieval Europe, pepper was so valuable it was used as currency. Some merchants paid their rent in peppercorns!"),
        .init(icon: "🧠", type: "Science", text: "Your brain uses about 20% of your body's total energy, even though it only makes up about 2% of your body weight."),
        .init(icon: "🌳", type: "Science", text: "There are more trees on Earth than stars in the Milky Way galaxy — approximately 3 trillion trees versus 200–400 billion stars."),
        .init(icon: "🐘", type: "Science", text: "Elephants are the only animals known to hold memorial gatherings for their dead — they mourn and revisit the bones of lost family members."),
        .init(icon: "⚗️", type: "Science", text: "Water is the only substance on Earth that naturally exists in all three states — solid (ice), liquid, and gas (steam) — at normal temperatures."),
        .init(icon: "🗺️", type: "History", text: "The first map of the world was drawn by Greek philosopher Anaximander around 550 BC. It showed the world as a flat disk surrounded by ocean."),
        .init(icon: "🎭", type: "History", text: "In ancient Greece, all actors were male and wore large masks so audiences could see expressions from far away. This is the origin of the theater comedy/tragedy symbols!"),
        .init(icon: "🔭", type: "Science", text: "When you look at a star, you see it as it was years, decades, or even millions of years ago. Some stars we can see may no longer exist!"),
        .init(icon: "🏹", type: "History", text: "The shortest war in history lasted only 38–45 minutes. It was between Britain and Zanzibar on August 27, 1896."),
        .init(icon: "🐬", type: "Science", text: "Dolphins sleep with one eye open. They rest half their brain at a time so they can continue breathing and watching for danger."),
        .init(icon: "🌞", type: "Science", text: "The Sun makes up 99.86% of the mass of our entire Solar System. Everything else — planets, moons, asteroids — is just 0.14%!"),
        .init(icon: "🦠", type: "Science", text: "There are more bacteria in your mouth right now than there are people on Earth — about 20 billion bacteria call your mouth home!"),
        .init(icon: "🎵", type: "Science", text: "Music triggers the same pleasure centers in the brain as food and hugs. That's why your favorite song can give you chills!"),
        .init(icon: "🌈", type: "Science", text: "Rainbows are actually full circles — you can only see half from the ground. Pilots in planes sometimes see complete circular rainbows!"),
        .init(icon: "⚔️", type: "History", text: "The word 'berserk' comes from 'berserkers' — elite Norse Viking warriors who would fight in a fierce, trance-like fury."),
        .init(icon: "🌿", type: "Science", text: "Bamboo is the fastest-growing plant on Earth. Some species can grow up to 91 cm (3 feet) in a single day!"),
        .init(icon: "🏺", type: "History", text: "The ancient Romans used urine to whiten their teeth and clean clothes. Urine collectors would stand on street corners with buckets!"),
        .init(icon: "💎", type: "Science", text: "Tooth enamel is the hardest substance in the human body — harder than bone! But unlike bone, it cannot repair itself once damaged."),
        .init(icon: "🌋", type: "Science", text: "There are more volcanoes under the ocean than on land. Most of Earth's volcanic activity happens along the 40,000-mile-long mid-ocean ridge."),
        .init(icon: "🐝", type: "Science", text: "A single honeybee will produce only 1/12 teaspoon of honey in its entire lifetime. It takes about 60,000 bees to fill one jar of honey!"),
        .init(icon: "📚", type: "History", text: "The Library of Alexandria contained an estimated 400,000–700,000 scrolls, making it the largest library in the ancient world."),
        .init(icon: "🪐", type: "Science", text: "Saturn's rings are mostly made of ice and rock particles ranging in size from grains of sand to boulders as large as a house."),
    ]

    static let newsItems: [NewsItem] = [
        .init(cat: "🚀 Space", headline: "Webb Telescope Discovers Ancient Galaxies", summary: "Scientists using the James Webb Space Telescope have identified thousands of previously unknown galaxies, revealing what the universe looked like just 500 million years after the Big Bang."),
        .init(cat: "🐾 Animals", headline: "Rare White Giraffe Spotted in Kenya", summary: "Conservationists spotted a leucistic giraffe in Kenya's national park. These animals lack pigmentation and appear white, making them extraordinarily rare in the wild."),
        .init(cat: "💡 Tech", headline: "Students Design Robot to Clean Ocean Plastic", summary: "A team of high school students won a global engineering competition with their autonomous robot that collects plastic waste from ocean surfaces without harming marine life."),
        .init(cat: "🔬 Science", headline: "New Solar Panel Generates Power From Windows", summary: "Scientists have developed ultra-thin solar panels that can be attached to windows, turning ordinary buildings into electricity generators — without blocking the view."),
        .init(cat: "🌿 Environment", headline: "Teen Invents Device to Purify River Water", summary: "A 15-year-old from India invented an affordable water purification device using local materials that can clean contaminated river water for drinking in just minutes."),
        .init(cat: "🐸 Animals", headline: "Colorful New Frog Species Found in Amazon", summary: "Biologists exploring the Amazon rainforest discovered a new species of dart frog with brilliant blue and yellow patterns that could help scientists develop new medicines."),
        .init(cat: "🚀 Space", headline: "Spacecraft Successfully Lands on the Moon", summary: "A new spacecraft successfully landed on the Moon, carrying scientific instruments designed to study the lunar surface and test technology for future human landings."),
        .init(cat: "💡 Tech", headline: "AI Decodes 4,000-Year-Old Ancient Language", summary: "Artificial intelligence successfully translated a mysterious ancient language that had puzzled historians for decades, unlocking secrets from Mesopotamian civilization."),
        .init(cat: "🌿 Environment", headline: "Giant Forest in Costa Rica Fully Restored", summary: "A massive reforestation effort in Costa Rica successfully restored over 3 million acres of tropical forest, bringing back wildlife and cleaner air to the region."),
        .init(cat: "🔬 Science", headline: "Scientists Grow Human Ear in Lab for Transplant", summary: "Medical researchers grew a human ear from a patient's own cartilage cells in a laboratory and successfully transplanted it to a child born without one."),
        .init(cat: "🐋 Animals", headline: "Humpback Whale Populations Show 30% Recovery", summary: "A new census shows humpback whale populations have grown by 30% in the past decade, thanks to international hunting bans and ocean conservation efforts."),
        .init(cat: "💡 Tech", headline: "Solar-Powered Plane Completes World Trip", summary: "An electric airplane powered entirely by solar energy completed a journey around the world, proving that long-distance solar flight is possible — inspiring the future of aviation."),
        .init(cat: "🔬 Science", headline: "Researchers Discover Why We Dream at Night", summary: "New brain research suggests dreams help the brain sort and store important memories while clearing out unnecessary information — like a nightly computer cleanup."),
        .init(cat: "🌿 Environment", headline: "Youth Group Plants 10 Million Trees in 20 Countries", summary: "A youth-led environmental organization reached its goal of planting 10 million trees across 20 countries, making it one of the largest student-led conservation efforts ever."),
        .init(cat: "💡 Tech", headline: "New Battery Could Charge Phone in 5 Minutes", summary: "Engineers have developed a new graphene-based battery that can charge a smartphone to 100% in under five minutes — and last for 20 years without degrading."),
        .init(cat: "🐆 Animals", headline: "Cheetah Cubs Born in India After 70 Years", summary: "For the first time in 70 years, cheetah cubs were born in the wild in India after a successful reintroduction program brought cheetahs from Namibia and South Africa."),
        .init(cat: "🔬 Science", headline: "Gene Therapy Successfully Treats Rare Disease", summary: "Scientists announced a new gene therapy that successfully treated a rare genetic disorder in children, offering hope to millions of families worldwide."),
        .init(cat: "🚀 Space", headline: "Earth-Sized Planet Found in Habitable Zone", summary: "NASA announced the discovery of an Earth-sized planet where conditions might be right for liquid water — and potentially life — around a nearby star."),
        .init(cat: "🌿 Environment", headline: "Coral Reef Shows Unexpected Signs of Recovery", summary: "Parts of the Great Barrier Reef are recovering faster than expected after efforts to reduce pollution and control invasive starfish that had been damaging the coral."),
        .init(cat: "🔬 Science", headline: "Scientists Create Material Stronger Than Diamonds", summary: "Researchers have engineered a new carbon-based material that outperforms diamonds in hardness tests, with potential uses in aerospace, medicine, and electronics."),
    ]

    static let quiz: [QuizQuestion] = [
        .init(q: "What is the largest planet in our Solar System?", opts: ["Saturn", "Jupiter", "Neptune", "Uranus"], ans: 1, exp: "Jupiter is the largest — all other planets could fit inside it!"),
        .init(q: "How many continents are there on Earth?", opts: ["5", "6", "7", "8"], ans: 2, exp: "7 continents: Africa, Antarctica, Asia, Australia, Europe, North America, South America."),
        .init(q: "What gas do plants use during photosynthesis?", opts: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], ans: 2, exp: "Plants absorb CO₂ and release oxygen — the opposite of what animals do!"),
        .init(q: "Which is the chemical symbol for water?", opts: ["WO", "H₂O", "HO₂", "W₂O"], ans: 1, exp: "H₂O means two hydrogen atoms bonded to one oxygen atom."),
        .init(q: "Who invented the telephone?", opts: ["Thomas Edison", "Nikola Tesla", "Alexander Graham Bell", "Benjamin Franklin"], ans: 2, exp: "Alexander Graham Bell patented the first practical telephone in 1876."),
        .init(q: "What is the fastest land animal?", opts: ["Lion", "Gazelle", "Horse", "Cheetah"], ans: 3, exp: "The cheetah can reach speeds up to 70 mph (112 km/h)."),
        .init(q: "How many bones does an adult human body have?", opts: ["196", "206", "216", "226"], ans: 1, exp: "Adults have 206 bones. Babies are born with ~270, but many fuse as we grow."),
        .init(q: "What is the capital city of France?", opts: ["Lyon", "Marseille", "Nice", "Paris"], ans: 3, exp: "Paris is the capital and largest city of France."),
        .init(q: "Which planet is called the Red Planet?", opts: ["Venus", "Mars", "Mercury", "Jupiter"], ans: 1, exp: "Mars gets its red color from iron oxide (rust) on its surface."),
        .init(q: "What is the hardest natural substance on Earth?", opts: ["Quartz", "Gold", "Diamond", "Iron"], ans: 2, exp: "Diamond rates 10 on the Mohs hardness scale — the highest possible."),
        .init(q: "Who wrote 'Romeo and Juliet'?", opts: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Homer"], ans: 1, exp: "Shakespeare wrote Romeo and Juliet around 1594–1596."),
        .init(q: "What is the largest ocean on Earth?", opts: ["Atlantic", "Indian", "Arctic", "Pacific"], ans: 3, exp: "The Pacific Ocean covers ~30% of Earth's surface — larger than all land combined!"),
        .init(q: "How many sides does a hexagon have?", opts: ["5", "6", "7", "8"], ans: 1, exp: "Hex = six. Think of a honeycomb — each cell is a hexagon!"),
        .init(q: "What organ pumps blood through your body?", opts: ["Liver", "Lung", "Brain", "Heart"], ans: 3, exp: "Your heart beats about 100,000 times every day!"),
        .init(q: "What is the longest river in the world?", opts: ["Amazon", "Mississippi", "Nile", "Yangtze"], ans: 2, exp: "The Nile River in Africa stretches about 6,650 km."),
        .init(q: "In what year did World War II end?", opts: ["1943", "1944", "1945", "1946"], ans: 2, exp: "WWII ended in 1945: Germany surrendered in May and Japan in September."),
        .init(q: "What is the smallest planet in our Solar System?", opts: ["Mercury", "Mars", "Venus", "Pluto"], ans: 0, exp: "Mercury is smallest (Pluto is a dwarf planet now). Mercury is barely larger than Earth's Moon."),
        .init(q: "What language is spoken in Brazil?", opts: ["Spanish", "Portuguese", "French", "Brazilian"], ans: 1, exp: "Brazil was colonized by Portugal, so Portuguese is the official language."),
        .init(q: "How many strings does a standard guitar have?", opts: ["4", "5", "6", "7"], ans: 2, exp: "A standard acoustic or electric guitar has 6 strings."),
        .init(q: "What is the square root of 144?", opts: ["11", "12", "13", "14"], ans: 1, exp: "12 × 12 = 144, so √144 = 12."),
        .init(q: "Which animal is the largest mammal on Earth?", opts: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], ans: 1, exp: "The blue whale is the largest animal ever known, reaching up to 30 meters long!"),
        .init(q: "What does HTML stand for?", opts: ["HyperText Makeup Language", "HyperText Markup Language", "HighText Markup Language", "HyperText Machine Language"], ans: 1, exp: "HTML (HyperText Markup Language) is the standard language for building web pages."),
        .init(q: "Where were the ancient Olympic Games held?", opts: ["Athens", "Rome", "Sparta", "Olympia"], ans: 3, exp: "The ancient Olympics began in Olympia, Greece, in 776 BC."),
        .init(q: "What is the most widely studied language globally?", opts: ["English", "Spanish", "Mandarin Chinese", "Hindi"], ans: 0, exp: "English is the most widely learned and used language worldwide, with ~1.5 billion speakers."),
        .init(q: "What does DNA stand for?", opts: ["Digital Nucleic Acid", "Deoxyribonucleic Acid", "Double Natural Atoms", "Dynamic Nucleic Assembly"], ans: 1, exp: "DNA = Deoxyribonucleic Acid, the molecule that carries genetic information."),
        .init(q: "How many colors are in a rainbow?", opts: ["5", "6", "7", "8"], ans: 2, exp: "7 colors: Red, Orange, Yellow, Green, Blue, Indigo, Violet (ROY G BIV)."),
        .init(q: "Who was the first person to walk on the Moon?", opts: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], ans: 1, exp: "Neil Armstrong walked on the Moon on July 20, 1969, during Apollo 11."),
        .init(q: "What is the approximate speed of light?", opts: ["150,000 km/s", "200,000 km/s", "300,000 km/s", "400,000 km/s"], ans: 2, exp: "Light travels at ~300,000 km/s (186,000 miles/s) in a vacuum."),
        .init(q: "Which continent has the most countries?", opts: ["Asia", "Europe", "South America", "Africa"], ans: 3, exp: "Africa has 54 recognized countries — more than any other continent."),
        .init(q: "How many players are on a basketball team on the court?", opts: ["4", "5", "6", "7"], ans: 1, exp: "Each basketball team has 5 players on the court at a time."),
    ]
}
