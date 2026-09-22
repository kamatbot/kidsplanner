"use strict";

// The Thursday figures below are deliberately a small, reviewed cache rather
// than live news scraping. Primary sources (checked 2026-09-22):
// https://www.nasa.gov/news-release/nasas-spacex-crew-8-astronauts-to-discuss-science-mission/
// https://www.nasa.gov/news-release/nasa-employees-win-top-federal-award-for-asteroid-deflection-mission/
// https://www.nasa.gov/news-release/nasa-sets-path-to-return-mars-samples-seeks-innovative-designs/
// https://www.nasa.gov/news-release/nasa-accelerates-space-exploration-earth-science-for-all-in-2024/
// They are dated data-literacy practice, not claims about current events.
const NEWS_DATA_SETS = [
  {
    chart: { title: "Crew-8 mission time", unit: "days", labels: ["Total mission", "Aboard station"], values: [235, 232], source: { title: "NASA’s SpaceX Crew-8 Astronauts to Discuss Science Mission", url: "https://www.nasa.gov/news-release/nasas-spacex-crew-8-astronauts-to-discuss-science-mission/", publishedAt: "2024-11-01T00:00:00Z" } },
    prompt: "How many more days did the Crew-8 mission last than the crew spent aboard the station?",
    answerIndex: 2,
    options: ["2 days", "232 days", "3 days", "467 days"],
    explanations: ["Subtract the station time from the total mission time.", "232 is the time aboard the station, not the difference.", "235 − 232 = 3 days.", "Adding the two values does not answer a difference question."],
  },
  {
    chart: { title: "DART target orbit (reported approximately)", unit: "hours", labels: ["Before impact (approx.)", "After impact (approx.)"], values: [12, 11.5], source: { title: "NASA Employees Win Top Federal Award for Asteroid Deflection Mission", url: "https://www.nasa.gov/news-release/nasa-employees-win-top-federal-award-for-asteroid-deflection-mission/", publishedAt: "2023-07-18T00:00:00Z" } },
    prompt: "About how many minutes shorter was the orbit after DART’s impact?",
    answerIndex: 1,
    options: ["0.5 minutes", "30 minutes", "12 minutes", "60 minutes"],
    explanations: ["The change is 0.5 hours, not 0.5 minutes.", "0.5 hour × 60 minutes per hour = 30 minutes.", "12 is the original orbit length in hours.", "One hour is larger than the half-hour change."],
  },
  {
    chart: { title: "Mars Sample Return estimated budget range", unit: "billions of dollars", labels: ["Lower estimate", "Upper estimate"], values: [8, 11], source: { title: "NASA Sets Path to Return Mars Samples, Seeks Innovative Designs", url: "https://www.nasa.gov/news-release/nasa-sets-path-to-return-mars-samples-seeks-innovative-designs/", publishedAt: "2024-04-15T00:00:00Z" } },
    prompt: "What is the width of the estimated budget range?",
    answerIndex: 0,
    options: ["$3 billion", "$8 billion", "$11 billion", "$19 billion"],
    explanations: ["11 − 8 = 3, so the range spans $3 billion.", "$8 billion is the lower endpoint.", "$11 billion is the upper endpoint.", "Adding endpoints does not give the width of a range."],
  },
  {
    chart: { title: "ISS visiting spacecraft in 2024", unit: "spacecraft", labels: ["All visiting spacecraft", "Commercial resupply missions"], values: [14, 8], source: { title: "NASA Accelerates Space Exploration, Earth Science for All in 2024", url: "https://www.nasa.gov/news-release/nasa-accelerates-space-exploration-earth-science-for-all-in-2024/", publishedAt: "2024-12-06T00:00:00Z" } },
    prompt: "How many visiting spacecraft were not commercial resupply missions?",
    answerIndex: 3,
    options: ["7 spacecraft", "8 spacecraft", "14 spacecraft", "6 spacecraft"],
    explanations: ["Subtracting gives 6, not 7.", "8 were commercial resupply missions.", "14 counts all visiting spacecraft.", "14 − 8 = 6 spacecraft."],
  },
];

// ponytail: this reviewed four-week source rotation must be expanded when a
// fifth distinct dated primary-source dataset is approved.

const MENTAL_MATH = [
  { title: "Multiply by 25", prompt: "Calculate 48 × 25 without long multiplication.", answer: "1200", explanation: "Because 25 = 100 ÷ 4, divide 48 by 4 to get 12, then multiply by 100: 1,200." },
  { title: "Squares ending in 5", prompt: "Calculate 35² using the ending-in-5 shortcut.", answer: "1225", explanation: "For a nonnegative integer ending in 5, multiply the part before 5 by the next integer, then append 25: 3 × 4 = 12, so 35² = 1225." },
  { title: "Multiply by 25", prompt: "Calculate 72 × 25 without long multiplication.", answer: "1800", explanation: "Because 25 = 100 ÷ 4, divide 72 by 4 to get 18, then multiply by 100: 1,800." },
  { title: "Squares ending in 5", prompt: "Calculate 85² using the ending-in-5 shortcut.", answer: "7225", explanation: "For a nonnegative integer ending in 5, multiply the part before 5 by the next integer, then append 25: 8 × 9 = 72, so 85² = 7225." },
];

const SAT_QUESTIONS = [
  { passage: "To study whether nighttime lighting affects moths’ visits to flowers, researchers placed identical flowering plants in sixteen plots. Eight plots were illuminated for four hours after sunset; the others remained dark. The researchers counted visits with cameras and rotated the plants among plots each week. On average, illuminated plots received fewer visits.", prompt: "Which finding, if true, would most directly strengthen the researchers’ conclusion that the lighting affected moth visits?", options: ["The cameras recorded similar numbers of visits in dark plots before the lights were installed.", "The illuminated plots had fewer visits even when the flowering plants were rotated among plots.", "Several moth species can detect wavelengths outside the visible range.", "The researchers conducted the study during the same season in each plot."], answerIndex: 1, explanations: ["A before-and-after comparison in only dark plots does not isolate the effect of lighting.", "The result persists after plant location is controlled, supporting lighting as the relevant difference.", "This background fact suggests a possible mechanism but does not test the study’s result.", "Consistent season controls one variable but does not directly establish the cause of the difference."] },
  { passage: "In a review of early maps, historian Li notes that coastal outlines were often copied from earlier charts, even when sailors had reported new measurements. Li argues that the persistence of those outlines reflects the authority of established mapmakers more than a lack of navigational knowledge.", prompt: "Which choice best states the main idea of the text?", options: ["Sailors’ reports were too inaccurate for mapmakers to use.", "Early mapmakers prioritized coastal outlines over all other geographic details.", "Established conventions could shape maps even when newer information was available.", "Li’s review proves that all early maps used identical coastal outlines."], answerIndex: 2, explanations: ["The passage says sailors reported new measurements; it does not question their accuracy.", "The passage compares copied outlines with new measurements, not coastal details with every other type of detail.", "This captures Li’s claim about the authority of existing maps despite newer observations.", "‘Often’ and ‘could’ do not support a claim about all maps being identical."] },
  { passage: "The editor praised the essay’s economy: every example advances its central claim, and the final paragraph does not repeat points already established. The essay is brief, but its argument remains fully developed.", prompt: "As used in the text, ‘economy’ most nearly refers to the essay’s", options: ["careful use of words and examples", "limited treatment of a complex subject", "reliance on financial evidence", "preference for familiar arguments"], answerIndex: 0, explanations: ["The supporting details all serve the central claim without repetition, which describes efficient expression.", "The text says the argument remains fully developed.", "No financial evidence is mentioned.", "The passage discusses repetition and relevance, not whether ideas are familiar."] },
  { passage: "Although the soil samples were collected from the same field, the samples ______ by different laboratories before the results were combined.", prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?", options: ["was analyzed", "were analyzed", "has been analyzed", "analyzes"], answerIndex: 1, explanations: ["The plural subject ‘samples’ cannot take singular ‘was.’", "The plural passive verb agrees with ‘samples’ and fits the completed action.", "The present perfect does not fit the stated past sequence as precisely as the simple past.", "An active singular verb does not agree with ‘samples’ or express that laboratories performed the action."] },
];

// ponytail: expand this four-question rotation when a fifth independently
// reviewed original item is ready; do not relabel it as College Board content.

const TRIVIA = [
  ["EARTH", "Trivia: The third planet from the Sun"], ["OCEAN", "Trivia: The largest continuous body of salt water"],
  ["MERCURY", "Trivia: The closest planet to the Sun"], ["NILE", "Trivia: A major river in northeastern Africa"],
  ["MAP", "Trivia: A drawing that represents places"], ["SATURN", "Trivia: The planet known for its prominent rings"],
  ["ORBIT", "Trivia: The path of an object around another object"], ["EQUATOR", "Trivia: The imaginary line halfway between Earth’s poles"],
];

function indexFor(date, length) { return Math.abs(Math.floor(date.getTime() / 86400000)) % length; }
const NEWS_WORD_STOPWORDS = new Set(["ABOUT", "AFTER", "ANOTHER", "FROM", "HAVE", "INTO", "NASA", "NEWS", "THAT", "THEIR", "THIS", "THOSE", "WITH", "WEEK", "WILL"]);
function isContentWord(value) {
  return /^[A-Z]{4,12}$/.test(value) && /[AEIOUY]/.test(value) && !NEWS_WORD_STOPWORDS.has(value);
}
function validNewsWord(item) {
  if (!item || !String(item.source || "").trim() || !String(item.headline || "").trim()) return null;
  let url; try { url = new URL(item.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const published = Date.parse(item.publishedAt || item.date || "");
  if (!Number.isFinite(published)) return null;
  const headline = String(item.headline).trim();
  const supplied = String(item.answer || "").trim().toUpperCase();
  if (supplied && (!isContentWord(supplied) || !new RegExp(`\\b${supplied}\\b`, "i").test(headline))) return null;
  const tokens = supplied ? [supplied] : (headline.match(/[A-Za-z]+/g) || []).map((value) => value.toUpperCase());
  const word = tokens.find(isContentWord);
  return word ? [word, `From ${String(item.source).trim()}: “${headline.replace(new RegExp(`\\b${word}\\b`, "ig"), "____").slice(0, 150)}”`, { source: String(item.source).trim(), url: url.href, publishedAt: new Date(published).toISOString() }] : null;
}

function weekendCrossword(date, newsItems, helpers) {
  const roots = helpers.weeklyWords(date).map(({ word, def }) => [word.toUpperCase(), def]);
  const monday = new Date(date.getTime());
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const validNews = (Array.isArray(newsItems) ? newsItems : []).filter((item) => {
    const published = Date.parse(item && (item.publishedAt || item.date || ""));
    return Number.isFinite(published) && published >= monday.getTime() && published <= date.getTime() + 86400000;
  }).map(validNewsWord).filter(Boolean);
  const orderedNews = validNews.slice(indexFor(date, validNews.length || 1)).concat(validNews.slice(0, indexFor(date, validNews.length || 1)));
  const orderedTrivia = TRIVIA.slice(indexFor(date, TRIVIA.length)).concat(TRIVIA.slice(0, indexFor(date, TRIVIA.length)));
  // ponytail: bounded 21 root subsets × all supplied safe news × eight trivia
  // answers; return an explicit unavailable result rather than widening search.
  const build = (newsEntries) => {
    for (let skipA = 0; skipA < roots.length; skipA++) for (let skipB = skipA + 1; skipB < roots.length; skipB++) {
      const fiveRoots = roots.filter((_, index) => index !== skipA && index !== skipB);
      const usedRoots = new Set(fiveRoots.map(([answer]) => answer));
      for (const newsEntry of newsEntries) {
        if (newsEntry && usedRoots.has(newsEntry[0])) continue;
        for (const trivia of orderedTrivia) {
          const answers = new Set(fiveRoots.map(([answer]) => answer));
          if (newsEntry) answers.add(newsEntry[0]);
          if (answers.has(trivia[0])) continue;
          const extras = newsEntry ? [newsEntry, trivia] : [trivia, orderedTrivia.find((entry) => entry[0] !== trivia[0] && !answers.has(entry[0]))];
          if (extras.some((entry) => !entry)) continue;
          const board = helpers.tryBuild(fiveRoots.concat(extras), { maxNodes: 6000, maxDimension: 16 });
          if (board && board.entries.length === 7) return board;
        }
      }
    }
    return null;
  };
  if (orderedNews.length) {
    const board = build(orderedNews);
    return board ? { board, hasNews: true } : { board: null, newsWasAvailable: true };
  }
  const board = build([null]);
  return board ? { board, hasNews: false } : null;
}

function getScheduledChallenge(date, newsItems, helpers) {
  const day = date.getUTCDay();
  const index = indexFor(date, 4);
  if ([1, 2].includes(day)) return { available: false, type: "brainteaser", title: "Daily Brain Teaser", instructions: "Open the existing Daily Brain Teaser to solve today’s riddle." };
  if (day === 3) return { available: true, type: "sudoku", title: "Wednesday Sudoku", mentalMath: MENTAL_MATH[index] };
  if (day === 4) {
    const item = NEWS_DATA_SETS[index];
    return { available: true, type: "news-analysis", title: "Thursday News Data Practice", instructions: "Read this dated primary-source data set; it is practice, not current news.", chart: item.chart, question: { id: `news-data-${index}`, passage: `Data reported by ${item.chart.source.title}.`, prompt: item.prompt, options: item.options, answerIndex: item.answerIndex, explanations: item.explanations } };
  }
  if (day === 5) {
    const question = SAT_QUESTIONS[index];
    return { available: true, type: "sat", title: "Digital SAT Question of the Week", question: { id: `sat-${index}`, ...question, attribution: "Original SAT-style practice; not a College Board question." } };
  }
  const crossword = weekendCrossword(date, newsItems, helpers);
  if (!crossword || !crossword.board) return { available: false, type: "crossword", title: "Weekend Learning Crossword", instructions: crossword && crossword.newsWasAvailable ? "A safe news item was available, but it could not fit this week’s bounded crossword. Try the vocabulary challenge instead." : "This week’s bounded crossword could not be arranged. Try the vocabulary challenge instead." };
  return { available: true, type: "crossword", title: "Weekend Learning Crossword", instructions: crossword.hasNews ? "Tap a clue, then type the whole answer. This edition combines this week’s vocabulary, a recent safe news item, and trivia." : "News unavailable; vocabulary and trivia edition. Tap a clue, then type the whole answer.", crossword: crossword.board };
}

module.exports = { getScheduledChallenge, NEWS_DATA_SETS, MENTAL_MATH, SAT_QUESTIONS, weekendCrossword };
