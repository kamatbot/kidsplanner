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
const LEGACY_QUESTIONS = [
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

// The active bank is intentionally separate from the legacy bank. Legacy qids
// are retained forever because answered/served state and in-flight clients may
// still refer to them, but they must not be selected for a new daily set.
const ACTIVE_QUESTIONS = [
  {
    qid: "bt31",
    q: "Four presentations are scheduled one per day from Monday through Thursday. P is before Q, R is immediately before S, and Q is not on Thursday. Which order could be valid?",
    options: ["Q, P, R, S", "P, Q, R, S", "R, S, P, Q", "P, R, S, Q"],
    answerIndex: 1,
    exp: "P, Q, R, S puts P before Q, keeps R immediately before S, and places Q on Tuesday rather than Thursday."
  },
  {
    qid: "bt32",
    q: "Ava, Ben, and Cora are each either a truth-teller or a consistent liar. Ava says, ‘Ben is a liar.’ Ben says, ‘Cora is a liar.’ Cora says, ‘Ava and Ben are different types.’ Who is which?",
    options: ["Ava truth-teller, Ben truth-teller, Cora liar", "Ava truth-teller, Ben liar, Cora truth-teller", "Ava liar, Ben truth-teller, Cora truth-teller", "Ava liar, Ben liar, Cora liar"],
    answerIndex: 1,
    exp: "Ava’s statement makes Ava and Ben opposite, and Ben’s makes Ben and Cora opposite, so Ava and Cora match. Only Ava and Cora truthful and Ben lying makes all three statements consistent."
  },
  {
    qid: "bt33",
    q: "A bag contains 4 red, 3 blue, and 2 green marbles. Two marbles are drawn without replacement. What is the probability that they have the same color?",
    options: ["1/9", "5/18", "1/3", "4/9"],
    answerIndex: 1,
    exp: "There are 36 unordered pairs. Matching pairs number C(4,2)+C(3,2)+C(2,2)=6+3+1=10, so the probability is 10/36=5/18."
  },
  {
    qid: "bt34",
    q: "In a class, 36 of 60 students take science, and 18 of those science students also take mathematics. Given that a student takes science, what is the probability that they also take mathematics?",
    options: ["1/3", "1/2", "3/5", "2/3"],
    answerIndex: 1,
    exp: "The condition narrows the sample to the 36 science students. Of those, 18 take mathematics, so 18/36=1/2."
  },
  {
    qid: "bt35",
    q: "A game pays $10 with probability 0.20, pays $2 with probability 0.50, and loses $4 with probability 0.30. What is the expected net result per play?",
    options: ["$0.80", "$1.80", "$2.40", "$3.00"],
    answerIndex: 1,
    exp: "Multiply each outcome by its probability: 10(0.20)+2(0.50)-4(0.30)=2+1-1.2=$1.80."
  },
  {
    qid: "bt36",
    q: "A drink concentrate is mixed with water in a 2:5 ratio. How many liters of concentrate are in 3.5 liters of the finished drink?",
    options: ["0.7 L", "1.0 L", "1.4 L", "2.0 L"],
    answerIndex: 1,
    exp: "The mixture has 7 total ratio parts, so concentrate is 2/7 of 3.5 L: (2/7)(3.5)=1.0 L."
  },
  {
    qid: "bt37",
    q: "A price is increased by 20% and then discounted by 20%. Compared with the original price, what is the final result?",
    options: ["No change", "A 4% decrease", "A 4% increase", "A 20% decrease"],
    answerIndex: 1,
    exp: "Successive multipliers are 1.20 and 0.80. Their product is 0.96, so the final price is 96% of the original, a 4% decrease."
  },
  {
    qid: "bt38",
    q: "A fills a tank in 6 hours, B fills it in 4 hours, and a drain empties it in 12 hours. If all three operate together, how long does filling take?",
    options: ["2 hours", "3 hours", "4 hours", "6 hours"],
    answerIndex: 1,
    exp: "The net hourly rate is 1/6+1/4-1/12=(2+3-1)/12=1/3 tank per hour, so one tank takes 3 hours."
  },
  {
    qid: "bt39",
    q: "If 2x+3y=19 and x-y=2, what are x and y?",
    options: ["x=3, y=5", "x=5, y=3", "x=4, y=2", "x=6, y=1"],
    answerIndex: 1,
    exp: "From x-y=2, x=y+2. Substitution gives 2(y+2)+3y=19, so y=3 and x=5."
  },
  {
    qid: "bt40",
    q: "The sequence 2, 6, 12, 20, 30 follows a consistent pattern. What is the next term?",
    options: ["36", "40", "42", "44"],
    answerIndex: 2,
    exp: "The differences are 4, 6, 8, and 10, increasing by 2; the next difference is 12, giving 30+12=42."
  },
  {
    qid: "bt41",
    q: "What is the smallest positive integer that leaves remainder 2 when divided by 5 and remainder 3 when divided by 7?",
    options: ["12", "17", "27", "32"],
    answerIndex: 1,
    exp: "Numbers that are 2 mod 5 are 2, 7, 12, 17, ...; 17 is the first of these that is 3 mod 7."
  },
  {
    qid: "bt42",
    q: "How many four-digit codes can be made from 0–9 if no digit repeats and the first digit cannot be 0?",
    options: ["3,024", "4,536", "5,040", "6,480"],
    answerIndex: 1,
    exp: "There are 9 choices for the first digit, then 9, 8, and 7 choices: 9×9×8×7=4,536."
  },
  {
    qid: "bt43",
    q: "Roads take 4 minutes from A to B, 6 from A to C, 5 from B to D, 2 from C to D, and 1 from B to C. What is the shortest travel time from A to D?",
    options: ["6 minutes", "7 minutes", "8 minutes", "9 minutes"],
    answerIndex: 1,
    exp: "The route A-B-C-D takes 4+1+2=7 minutes. A-C-D takes 8 and A-B-D takes 9, so 7 is shortest."
  },
  {
    qid: "bt44",
    q: "A loop starts with x=1 and, for i=1,2,3,4, replaces x with 2x+i. What is x after the loop?",
    options: ["32", "40", "42", "45"],
    answerIndex: 2,
    exp: "The values are 1→3→8→19→42 for i=1 through 4, so the final value is 42."
  },
  {
    qid: "bt45",
    q: "An algorithm compares every pair among 10 items exactly once. How many comparisons does it make?",
    options: ["20", "45", "90", "100"],
    answerIndex: 1,
    exp: "Each pair is counted once, so the number is 10×9/2=45; dividing by 2 avoids counting A-B and B-A separately."
  },
  {
    qid: "bt46",
    q: "Students test whether fertilizer changes plant growth, but the plants currently sit in different light levels. What design change best isolates the fertilizer’s effect?",
    options: ["Use more fertilizer on plants in the darkest spot", "Randomly assign plants to fertilizer and control groups and rotate their positions", "Measure only the tallest plant in each group", "Give every plant fertilizer and compare them with last year’s plants"],
    answerIndex: 1,
    exp: "Random assignment and rotating positions balance light exposure, while a no-fertilizer control makes fertilizer the main systematic difference."
  },
  {
    qid: "bt47",
    q: "To test how pendulum length affects its period, which variables should be held constant?",
    options: ["Only the measured period", "Bob mass and release angle", "Length and release angle", "Bob mass and length"],
    answerIndex: 1,
    exp: "Change length while keeping bob mass and release angle fixed; then observed period changes can be attributed more fairly to length."
  },
  {
    qid: "bt48",
    q: "Five readings are 12, 14, 15, 17, and 42. Which statistic best describes a typical reading?",
    options: ["Mean, 20", "Median, 15", "Range, 30", "Maximum, 42"],
    answerIndex: 1,
    exp: "The 42 is an outlier that pulls the mean upward. The middle ordered value, 15, better represents the typical reading."
  },
  {
    qid: "bt49",
    q: "Five numbers have mean 18. Four of them are 12, 17, 20, and 25. What is the fifth number?",
    options: ["14", "16", "18", "20"],
    answerIndex: 1,
    exp: "The total must be 5×18=90. The known values total 74, so the missing value is 90-74=16."
  },
  {
    qid: "bt50",
    q: "A study finds a correlation of +0.8 between hours of practice and performance. Which conclusion is justified?",
    options: ["Practice definitely causes every performance difference", "There is a strong positive association, but causation is not established", "The variables have no relationship", "Performance causes exactly 80% of practice"],
    answerIndex: 1,
    exp: "A positive correlation indicates that higher practice hours tend to accompany higher performance; other factors or reverse causation could still matter."
  },
  {
    qid: "bt51",
    q: "A school estimates every student’s average screen time by surveying only members of its gaming club. What is the main problem?",
    options: ["Random error is impossible", "Selection bias makes the sample unrepresentative", "The survey has too many variables", "Averages cannot be used for time"],
    answerIndex: 1,
    exp: "Gaming-club members may differ systematically from other students, so their responses cannot reliably represent the whole school."
  },
  {
    qid: "bt52",
    q: "Which is the strongest evidence for the claim that a region’s annual rainfall has increased?",
    options: ["One resident remembers wetter summers", "A viral post shows a flooded street", "A 30-year record from calibrated rain gauges shows an upward trend", "A town has built more umbrella shops"],
    answerIndex: 2,
    exp: "A long, consistently measured record directly tracks the quantity and reveals a trend, while anecdotes and indirect signs are less reliable."
  },
  {
    qid: "bt53",
    q: "An argument says: ‘Everyone who wins the debate practiced. Maya practiced, so Maya won.’ What is the reasoning error?",
    options: ["It treats a necessary condition as sufficient", "It uses a numerical average", "It reverses cause and effect in every case", "It compares two unrelated samples"],
    answerIndex: 0,
    exp: "Winning implies practice in the stated premise, but practice does not imply winning; other practiced students may lose."
  },
  {
    qid: "bt54",
    q: "A factory sensor detects 90% of defective items and falsely alarms for 5% of good items. If 1% of items are defective, about what fraction of alarms indicate a real defect?",
    options: ["1%", "15.4%", "50%", "90%"],
    answerIndex: 1,
    exp: "Among 10,000 items, about 90 defective items alarm and 495 good items falsely alarm. Thus 90/(90+495)≈15.4%."
  },
  {
    qid: "bt55",
    q: "A rectangle has perimeter 34 cm, and its length is 3 cm greater than its width. What is its area?",
    options: ["60 cm²", "70 cm²", "80 cm²", "90 cm²"],
    answerIndex: 1,
    exp: "Length plus width is 17. With length=width+3, width=7 and length=10, so the area is 10×7=70 cm²."
  },
  {
    qid: "bt56",
    q: "Point (2,-1) is reflected across the y-axis and then translated by (3,4). Where does it end?",
    options: ["(1,3)", "(5,3)", "(1,5)", "(-5,3)"],
    answerIndex: 0,
    exp: "Reflection across the y-axis changes (2,-1) to (-2,-1). Adding (3,4) gives (1,3)."
  },
  {
    qid: "bt57",
    q: "A cube has side length 4 and is painted on every outer face before being cut into 1-unit cubes. How many small cubes have exactly two painted faces?",
    options: ["8", "16", "24", "32"],
    answerIndex: 2,
    exp: "Exactly-two-face cubes lie along edges but not at corners. There are 12 edges and 4-2=2 such cubes per edge, giving 24."
  },
  {
    qid: "bt58",
    q: "Two cars have the same momentum, but one has twice the mass of the other. How do their kinetic energies compare?",
    options: ["They are equal", "The heavier car has twice as much", "The lighter car has twice as much", "The lighter car has four times as much"],
    answerIndex: 2,
    exp: "For fixed momentum, kinetic energy is p²/(2m), so doubling mass halves energy. The lighter car therefore has twice the energy."
  },
  {
    qid: "bt59",
    q: "An object is dropped from rest through height H, ignoring air resistance. At height H/2 above the ground, what fraction of its original gravitational potential energy has become kinetic energy?",
    options: ["1/4", "1/2", "1/√2", "1"],
    answerIndex: 1,
    exp: "Potential energy is proportional to height. At H/2, half remains, so conservation of energy says the other half has become kinetic energy."
  },
  {
    qid: "bt60",
    q: "For 2Al+3Cl₂→2AlCl₃, 4 mol Al react with 5 mol Cl₂. Which reactant limits the reaction, and how much AlCl₃ can form?",
    options: ["Al; 4 mol", "Cl₂; 10/3 mol", "Al; 8/3 mol", "Cl₂; 5 mol"],
    answerIndex: 1,
    exp: "Four mol Al would need 6 mol Cl₂, but only 5 are available, so Cl₂ limits. The 3:2 ratio gives 5×2/3=10/3 mol AlCl₃."
  },
  {
    qid: "bt61",
    q: "A recessive trait occurs when a child has aa. Two parents are both Aa. Given that their child does not have the trait, what is the probability the child is a carrier (Aa)?",
    options: ["1/4", "1/2", "2/3", "3/4"],
    answerIndex: 2,
    exp: "The offspring probabilities are AA=1/4, Aa=1/2, aa=1/4. Conditioning on not aa leaves 3/4, of which 1/2 are Aa, giving (1/2)/(3/4)=2/3."
  },
  {
    qid: "bt62",
    q: "An enzyme’s measured reaction rates at pH 5, 6, 7, and 8 are 12, 20, 28, and 19 units. What is the best inference?",
    options: ["The rate always rises as pH rises", "The enzyme’s peak among these tested values is pH 7", "pH has no effect", "The peak must be pH 9"],
    answerIndex: 1,
    exp: "The largest measured rate is 28 at pH 7. The data support pH 7 as the best tested value, not a claim about untested pH values."
  },
  {
    qid: "bt63",
    q: "In a simple Doppler interpretation, light from a distant galaxy has spectral lines shifted toward longer, redder wavelengths than expected. What does this most directly suggest?",
    options: ["The galaxy is moving toward us", "The galaxy is moving away from us", "The galaxy has no motion", "The galaxy must be hotter than every star"],
    answerIndex: 1,
    exp: "A redshift means observed wavelengths are stretched; for an approaching-or-receding source, that indicates motion away from the observer."
  },
  {
    qid: "bt64",
    q: "A study reports that a new teaching method raised scores by 8 points, but it used no comparison group. What is the key limitation?",
    options: ["Scores cannot be averaged", "Improvement could reflect practice, time, or another change rather than the method", "The method must be harmful", "A comparison group would remove all bias"],
    answerIndex: 1,
    exp: "Without a control or comparison group, there is no baseline for separating the method’s effect from normal growth or other simultaneous changes."
  },
  {
    qid: "bt65",
    q: "Four runners finish 1st through 4th. Noor finishes immediately before Kim, Kim finishes before Lee, and Maya is not first. Which order could be valid?",
    options: ["Noor, Kim, Lee, Maya", "Kim, Noor, Lee, Maya", "Maya, Noor, Lee, Kim", "Noor, Lee, Kim, Maya"],
    answerIndex: 0,
    exp: "Noor-Kim is consecutive, Kim is ahead of Lee, and Maya is fourth in this order, so all three rules hold."
  },
  {
    qid: "bt66",
    q: "A rectangular garden uses a wall as one side, so 40 m of fencing covers only the other three sides. What maximum area is possible?",
    options: ["200 m²", "300 m²", "400 m²", "800 m²"],
    answerIndex: 0,
    exp: "If each short side is x, the long side is 40-2x and area is x(40-2x), maximized at x=10. The long side is 20, giving 200 m²."
  },
  {
    qid: "bt67",
    q: "In a group, 25 students study physics, 18 study computer science, and 10 study both. How many study at least one of the two subjects?",
    options: ["28", "33", "35", "43"],
    answerIndex: 1,
    exp: "Add the groups and subtract the 10 counted twice: 25+18-10=33 students."
  },
  {
    qid: "bt68",
    q: "A recursive function returns 0 for f(0) and otherwise returns n+f(n-2). What does f(6) return?",
    options: ["6", "10", "12", "14"],
    answerIndex: 2,
    exp: "Expanding gives f(6)=6+f(4)=6+4+f(2)=6+4+2+f(0)=12."
  },
  {
    qid: "bt69",
    q: "Two fair six-sided dice are rolled. What is the probability that their sum is at least 10?",
    options: ["1/12", "1/6", "1/4", "1/3"],
    answerIndex: 1,
    exp: "Sums 10, 11, and 12 have 3, 2, and 1 outcomes respectively: 6 of 36, or 1/6."
  },
  {
    qid: "bt70",
    q: "Class A has 20 students with mean score 80; Class B has 30 students with mean score 70. What is the combined mean?",
    options: ["72", "74", "75", "76"],
    answerIndex: 1,
    exp: "Use totals, not the mean of the means: (20×80+30×70)/(20+30)=3700/50=74."
  },
];

// Keep QUESTIONS as the compatibility export used by existing callers/tests.
// New selection code deliberately uses ACTIVE_QUESTIONS instead.
const ALL_QUESTIONS = [...LEGACY_QUESTIONS, ...ACTIVE_QUESTIONS];
const QUESTIONS = ALL_QUESTIONS;

module.exports = { QUESTIONS, ALL_QUESTIONS, LEGACY_QUESTIONS, ACTIVE_QUESTIONS };
