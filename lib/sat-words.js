"use strict";
/**
 * The 30 SAT vocabulary words for the "word of the day" / word bank feature —
 * ported verbatim from iOS `Domain/DailyContent.swift` `Daily.words` (which
 * itself was ported from the web app's public/js/app.js SAT_WORDS) so
 * server, web, and iOS all quiz on the exact same word list.
 */
const WORDS = [
  { word: "Eloquent", pos: "adjective", def: "Fluent or persuasive in speaking or writing.", example: "The eloquent speaker captivated the audience with her powerful words." },
  { word: "Persevere", pos: "verb", def: "Continue in a course of action despite difficulty or with little indication of success.", example: "She decided to persevere with her studies despite the many challenges." },
  { word: "Diligent", pos: "adjective", def: "Showing care and conscientiousness in one's work or duties.", example: "The diligent student always completed his homework before watching TV." },
  { word: "Benevolent", pos: "adjective", def: "Well-meaning and kindly; generous or charitable.", example: "The benevolent teacher stayed after class to help struggling students." },
  { word: "Tenacious", pos: "adjective", def: "Tending to keep a firm hold; persistent.", example: "The tenacious athlete practiced every day for three years to reach the Olympics." },
  { word: "Ambiguous", pos: "adjective", def: "Open to more than one interpretation; unclear.", example: "The teacher's ambiguous instructions confused many students in the class." },
  { word: "Candid", pos: "adjective", def: "Truthful and straightforward; frank.", example: "She gave a candid answer about why she didn't finish her homework." },
  { word: "Meticulous", pos: "adjective", def: "Showing great attention to detail; very careful and precise.", example: "The meticulous scientist checked each experiment three times before recording results." },
  { word: "Resilient", pos: "adjective", def: "Able to withstand or recover quickly from difficult conditions.", example: "Despite failing twice, the resilient student tried again and passed the exam." },
  { word: "Collaborate", pos: "verb", def: "Work jointly on an activity, especially to produce or create something.", example: "The students decided to collaborate on the science project to combine their strengths." },
  { word: "Empathy", pos: "noun", def: "The ability to understand and share the feelings of another.", example: "She showed great empathy when her friend was upset about not making the team." },
  { word: "Innovative", pos: "adjective", def: "Featuring new methods; advanced and original.", example: "The innovative inventor created a device that solved a common household problem." },
  { word: "Intrepid", pos: "adjective", def: "Fearless; adventurous.", example: "The intrepid explorer ventured deep into the jungle without hesitation." },
  { word: "Verbose", pos: "adjective", def: "Using more words than are needed.", example: "His verbose essay needed editing because the main point got lost in extra words." },
  { word: "Pragmatic", pos: "adjective", def: "Dealing with things sensibly and realistically based on practical considerations.", example: "The pragmatic student chose an essay topic she already knew well to save time." },
  { word: "Prolific", pos: "adjective", def: "Present in large numbers or quantities; highly productive.", example: "The prolific author wrote over 50 books during his lifetime." },
  { word: "Resolute", pos: "adjective", def: "Admirably purposeful, determined, and unwavering.", example: "She was resolute in her decision to become a doctor, despite the long years of study." },
  { word: "Skeptical", pos: "adjective", def: "Not easily convinced; having doubts or reservations.", example: "He was skeptical about the magic trick until he saw it performed three times." },
  { word: "Steadfast", pos: "adjective", def: "Resolutely firm and unwavering.", example: "She remained steadfast in her belief that hard work would lead to success." },
  { word: "Ubiquitous", pos: "adjective", def: "Present, appearing, or found everywhere.", example: "Smartphones have become ubiquitous in modern society." },
  { word: "Vivacious", pos: "adjective", def: "Attractively lively and animated.", example: "The vivacious student lit up every classroom discussion with her enthusiasm." },
  { word: "Zealous", pos: "adjective", def: "Having or showing great energy or enthusiasm in pursuit of a goal.", example: "The zealous volunteer spent every weekend helping at the animal shelter." },
  { word: "Adept", pos: "adjective", def: "Very skilled or proficient at something.", example: "After years of practice, she became adept at playing the violin." },
  { word: "Astute", pos: "adjective", def: "Having an ability to accurately assess situations and turn this to one's advantage.", example: "The astute student noticed the pattern in the math problem before others did." },
  { word: "Coherent", pos: "adjective", def: "Logical and consistent; forming a unified whole.", example: "A coherent essay has a clear introduction, body, and conclusion." },
  { word: "Enigmatic", pos: "adjective", def: "Difficult to interpret or understand; mysterious.", example: "The Mona Lisa's smile is considered enigmatic — no one can tell exactly what emotion it shows." },
  { word: "Transient", pos: "adjective", def: "Lasting only for a short time; impermanent.", example: "The snow was transient, melting by noon on the first day of spring." },
  { word: "Placid", pos: "adjective", def: "Not easily upset or excited; calm and peaceful.", example: "The placid lake reflected the mountains perfectly on the windless morning." },
  { word: "Credible", pos: "adjective", def: "Able to be believed; convincing.", example: "Use credible sources like encyclopedias and textbooks for your research paper." },
  { word: "Wary", pos: "adjective", def: "Feeling or showing caution about possible dangers or problems.", example: "Be wary of anyone who promises easy success without hard work." },
];

module.exports = { WORDS };
