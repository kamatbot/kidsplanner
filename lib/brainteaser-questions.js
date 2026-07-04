"use strict";
/**
 * Brain teaser question bank for the daily quiz widget — ported from iOS
 * `Domain/DailyContent.swift` `Daily.quiz` (itself ported from the web app's
 * QUIZ array) and expanded with a stable `qid` per question (required so
 * server-side "resurface previously wrong" tracking survives edits to this
 * list — qids are never reused/renumbered).
 *
 * Shape: { qid, q, options:[...4], answerIndex, exp }
 */
const QUESTIONS = [
  { qid: "bt1", q: "What is the largest planet in our Solar System?", options: ["Saturn", "Jupiter", "Neptune", "Uranus"], answerIndex: 1, exp: "Jupiter is the largest — all other planets could fit inside it!" },
  { qid: "bt2", q: "How many continents are there on Earth?", options: ["5", "6", "7", "8"], answerIndex: 2, exp: "7 continents: Africa, Antarctica, Asia, Australia, Europe, North America, South America." },
  { qid: "bt3", q: "What gas do plants use during photosynthesis?", options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], answerIndex: 2, exp: "Plants absorb CO2 and release oxygen — the opposite of what animals do!" },
  { qid: "bt4", q: "Which is the chemical symbol for water?", options: ["WO", "H2O", "HO2", "W2O"], answerIndex: 1, exp: "H2O means two hydrogen atoms bonded to one oxygen atom." },
  { qid: "bt5", q: "Who invented the telephone?", options: ["Thomas Edison", "Nikola Tesla", "Alexander Graham Bell", "Benjamin Franklin"], answerIndex: 2, exp: "Alexander Graham Bell patented the first practical telephone in 1876." },
  { qid: "bt6", q: "What is the fastest land animal?", options: ["Lion", "Gazelle", "Horse", "Cheetah"], answerIndex: 3, exp: "The cheetah can reach speeds up to 70 mph (112 km/h)." },
  { qid: "bt7", q: "How many bones does an adult human body have?", options: ["196", "206", "216", "226"], answerIndex: 1, exp: "Adults have 206 bones. Babies are born with ~270, but many fuse as we grow." },
  { qid: "bt8", q: "What is the capital city of France?", options: ["Lyon", "Marseille", "Nice", "Paris"], answerIndex: 3, exp: "Paris is the capital and largest city of France." },
  { qid: "bt9", q: "Which planet is called the Red Planet?", options: ["Venus", "Mars", "Mercury", "Jupiter"], answerIndex: 1, exp: "Mars gets its red color from iron oxide (rust) on its surface." },
  { qid: "bt10", q: "What is the hardest natural substance on Earth?", options: ["Quartz", "Gold", "Diamond", "Iron"], answerIndex: 2, exp: "Diamond rates 10 on the Mohs hardness scale — the highest possible." },
  { qid: "bt11", q: "Who wrote 'Romeo and Juliet'?", options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Homer"], answerIndex: 1, exp: "Shakespeare wrote Romeo and Juliet around 1594-1596." },
  { qid: "bt12", q: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], answerIndex: 3, exp: "The Pacific Ocean covers ~30% of Earth's surface — larger than all land combined!" },
  { qid: "bt13", q: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], answerIndex: 1, exp: "Hex = six. Think of a honeycomb — each cell is a hexagon!" },
  { qid: "bt14", q: "What organ pumps blood through your body?", options: ["Liver", "Lung", "Brain", "Heart"], answerIndex: 3, exp: "Your heart beats about 100,000 times every day!" },
  { qid: "bt15", q: "What is the longest river in the world?", options: ["Amazon", "Mississippi", "Nile", "Yangtze"], answerIndex: 2, exp: "The Nile River in Africa stretches about 6,650 km." },
  { qid: "bt16", q: "In what year did World War II end?", options: ["1943", "1944", "1945", "1946"], answerIndex: 2, exp: "WWII ended in 1945: Germany surrendered in May and Japan in September." },
  { qid: "bt17", q: "What is the smallest planet in our Solar System?", options: ["Mercury", "Mars", "Venus", "Pluto"], answerIndex: 0, exp: "Mercury is smallest (Pluto is a dwarf planet now). Mercury is barely larger than Earth's Moon." },
  { qid: "bt18", q: "What language is spoken in Brazil?", options: ["Spanish", "Portuguese", "French", "Brazilian"], answerIndex: 1, exp: "Brazil was colonized by Portugal, so Portuguese is the official language." },
  { qid: "bt19", q: "How many strings does a standard guitar have?", options: ["4", "5", "6", "7"], answerIndex: 2, exp: "A standard acoustic or electric guitar has 6 strings." },
  { qid: "bt20", q: "What is the square root of 144?", options: ["11", "12", "13", "14"], answerIndex: 1, exp: "12 x 12 = 144, so the square root of 144 = 12." },
  { qid: "bt21", q: "Which animal is the largest mammal on Earth?", options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], answerIndex: 1, exp: "The blue whale is the largest animal ever known, reaching up to 30 meters long!" },
  { qid: "bt22", q: "What does HTML stand for?", options: ["HyperText Makeup Language", "HyperText Markup Language", "HighText Markup Language", "HyperText Machine Language"], answerIndex: 1, exp: "HTML (HyperText Markup Language) is the standard language for building web pages." },
  { qid: "bt23", q: "Where were the ancient Olympic Games held?", options: ["Athens", "Rome", "Sparta", "Olympia"], answerIndex: 3, exp: "The ancient Olympics began in Olympia, Greece, in 776 BC." },
  { qid: "bt24", q: "What is the most widely studied language globally?", options: ["English", "Spanish", "Mandarin Chinese", "Hindi"], answerIndex: 0, exp: "English is the most widely learned and used language worldwide, with ~1.5 billion speakers." },
  { qid: "bt25", q: "What does DNA stand for?", options: ["Digital Nucleic Acid", "Deoxyribonucleic Acid", "Double Natural Atoms", "Dynamic Nucleic Assembly"], answerIndex: 1, exp: "DNA = Deoxyribonucleic Acid, the molecule that carries genetic information." },
  { qid: "bt26", q: "How many colors are in a rainbow?", options: ["5", "6", "7", "8"], answerIndex: 2, exp: "7 colors: Red, Orange, Yellow, Green, Blue, Indigo, Violet (ROY G BIV)." },
  { qid: "bt27", q: "Who was the first person to walk on the Moon?", options: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], answerIndex: 1, exp: "Neil Armstrong walked on the Moon on July 20, 1969, during Apollo 11." },
  { qid: "bt28", q: "What is the approximate speed of light?", options: ["150,000 km/s", "200,000 km/s", "300,000 km/s", "400,000 km/s"], answerIndex: 2, exp: "Light travels at ~300,000 km/s (186,000 miles/s) in a vacuum." },
  { qid: "bt29", q: "Which continent has the most countries?", options: ["Asia", "Europe", "South America", "Africa"], answerIndex: 3, exp: "Africa has 54 recognized countries — more than any other continent." },
  { qid: "bt30", q: "How many players are on a basketball team on the court?", options: ["4", "5", "6", "7"], answerIndex: 1, exp: "Each basketball team has 5 players on the court at a time." },
];

module.exports = { QUESTIONS };
