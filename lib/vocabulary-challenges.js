"use strict";

const { DAILY_WORDS } = require("./sat-words");
const DAY_MS = 86400000;

// Each authored set has two correct uses followed by one misapplication.
// Keep the rationales attached when rotating the displayed order.
const CONTEXTS = [
  [
    ["Her eloquent appeal persuaded the council to save the library.", "Her persuasive speaking is eloquent."],
    ["The eloquent letter expressed his gratitude with clarity and feeling.", "Writing can be eloquent when it expresses ideas fluently."],
    ["His eloquent speech boomed through the hall, its tangled sentences conveying no clear message.", "Loudness does not make a speech eloquent; the tangled, ineffective expression contradicts fluent or persuasive speaking."],
  ],
  [
    ["We will persevere with the puzzle even after several failed attempts.", "Continuing despite failed attempts is to persevere."],
    ["The runners had to persevere through the final uphill mile.", "They continue despite a difficult stretch."],
    ["She chose to persevere with violin by quitting permanently at the first difficult piece.", "Ending the lessons because they become difficult is giving up, not persevering."],
  ],
  [
    ["The diligent editor checked every name against the original records.", "Careful checking shows diligence."],
    ["A diligent gardener inspected the seedlings each morning.", "Consistent, conscientious care is diligent work."],
    ["His diligent editing saved time by skipping every check for errors.", "Speed gained by neglecting accuracy is not diligent work; diligence requires conscientious care."],
  ],
  [
    ["A benevolent neighbor bought groceries for the family during their illness.", "The neighbor acts kindly to help others."],
    ["The benevolent fund paid for meals for people who could not afford them.", "A charitable fund can be described as benevolent."],
    ["Her benevolent offer of help was intended only to humiliate the newcomer.", "An offer intended only to humiliate someone is not well-meaning or kindly, even if it sounds helpful."],
  ],
  [
    ["The tenacious detective kept investigating after every lead went cold.", "Persistent effort despite setbacks is tenacious."],
    ["The tenacious vine clung firmly to the stone wall.", "Tenacious can describe something that keeps a firm physical hold."],
    ["His tenacious method was to abandon each puzzle at its first difficulty.", "Immediately abandoning each difficult puzzle shows no persistence, so the approach is not tenacious."],
  ],
  [
    ["The ambiguous message could mean either today or tomorrow.", "Two possible interpretations make the message ambiguous."],
    ["An ambiguous ending left readers unsure which character had returned.", "The ending allows more than one interpretation."],
    ["The ambiguous instruction had one perfectly clear meaning that she disliked.", "Disliking an instruction does not make it ambiguous; a single clear meaning rules out multiple interpretations."],
  ],
  [
    ["In a candid interview, she admitted that the plan had failed.", "A frank admission is candid."],
    ["His candid feedback explained exactly which parts needed improvement.", "Direct, honest feedback is candid."],
    ["His candid explanation concealed the truth behind a carefully invented excuse.", "An intentionally deceptive explanation is not candid, however convincing it sounds."],
  ],
  [
    ["The meticulous restorer matched each tiny tile to an old photograph.", "Attention to small details is meticulous."],
    ["She kept meticulous notes of every measurement and correction.", "Precise, careful records are meticulous."],
    ["Her meticulous estimate was an unchecked guess, without a single measurement.", "An unchecked guess is not meticulous; meticulous work requires careful attention to detail."],
  ],
  [
    ["The resilient team recovered from its defeat and played confidently again.", "Recovering from a setback shows resilience."],
    ["The resilient fabric returned to its shape after being stretched.", "A material that recovers its shape is resilient."],
    ["The resilient material bent easily but suffered permanent damage from the slightest bend.", "Flexibility alone is not resilience; material that is permanently ruined by slight bending neither withstands nor recovers from it."],
  ],
  [
    ["The classes will collaborate to create one school newspaper.", "Working jointly on one product is collaboration."],
    ["The composer and poet will collaborate on a new song.", "They contribute together to the same creative work."],
    ["The writers would collaborate through entirely separate work, without any joint contribution.", "Entirely separate work with no joint contribution is not collaboration, even when both people are writers."],
  ],
  [
    ["Her empathy helped her understand why her friend felt excluded.", "Understanding another person's feelings shows empathy."],
    ["Remembering his own first day, he felt empathy for the nervous newcomer.", "His experience helps him share the newcomer's feelings."],
    ["His empathy revealed only his own feelings, without understanding or sharing anyone else's.", "Awareness of one's own feelings is not empathy, which concerns understanding and sharing another person's feelings."],
  ],
  [
    ["Their innovative design used a new folding method to save space.", "A new method makes the design innovative."],
    ["The innovative lesson let students explore a topic through an original game.", "An original teaching approach can be innovative."],
    ["The innovative method reproduced the old routine exactly, introducing nothing original.", "Exact repetition without any new or original method is not innovative."],
  ],
  [
    ["The intrepid climber eagerly set out along the unexplored ridge.", "An adventurous willingness to explore is intrepid."],
    ["An intrepid reporter entered the dangerous area to document the rescue.", "Facing danger boldly is intrepid."],
    ["Her intrepid response was to avoid the safe trail out of fear.", "Avoiding even a safe new experience solely from fear is not a fearless or adventurous response."],
  ],
  [
    ["The verbose instructions repeated the same simple step in four paragraphs.", "Unnecessary repetition makes the instructions verbose."],
    ["His verbose speech took twenty minutes to deliver a two-minute message.", "Using far more words than needed is verbose."],
    ["The verbose reply expressed everything needed without a single unnecessary word.", "Using only the necessary words is concise; verbose means using more words than needed."],
  ],
  [
    ["The pragmatic organizer moved the picnic indoors when rain began.", "Adapting sensibly to actual conditions is pragmatic."],
    ["Her pragmatic plan used the tools and budget already available.", "A realistic plan based on resources is pragmatic."],
    ["His pragmatic decision followed the rule despite proof that it could not work.", "Rigidly following an unworkable rule ignores practical reality; that is dogmatic rather than pragmatic."],
  ],
  [
    ["The prolific composer finished dozens of pieces each year.", "Producing many works is prolific."],
    ["The prolific tomato plant supplied baskets of fruit all summer.", "Producing a large quantity of fruit is prolific."],
    ["The prolific author's entire output was one short poem, admired by millions.", "Popularity is not productivity; prolific describes a large output, not the success of one small work."],
  ],
  [
    ["She remained resolute about finishing the race despite the cold.", "An unwavering determination is resolute."],
    ["His resolute refusal did not change under pressure.", "A firm, unchanging decision is resolute."],
    ["Her resolute position shifted with every suggestion as she struggled to decide.", "A position that continually changes through indecision is not firm or unwavering."],
  ],
  [
    ["The skeptical reader asked for evidence before accepting the claim.", "Questioning a claim before believing it is skeptical."],
    ["He was skeptical that the old bicycle could survive another long trip.", "Doubts about the bicycle's reliability are skepticism."],
    ["He was skeptical of the advertisement, accepting every claim without any reservation.", "Immediate, unquestioning acceptance is not skepticism, which involves doubts or reservations."],
  ],
  [
    ["Her steadfast support continued through every difficult season.", "Unwavering support is steadfast."],
    ["He stayed steadfast in his promise even when keeping it became inconvenient.", "Remaining firm in a commitment is steadfast."],
    ["His steadfast loyalty switched instantly to whichever team offered a better gift.", "Loyalty that switches for each better offer is changeable, not steadfast or unwavering."],
  ],
  [
    ["Bicycles were ubiquitous in the town, appearing on every street.", "Being found throughout a place is ubiquitous."],
    ["The catchy tune became ubiquitous, playing in shops, buses, and homes.", "The tune is heard everywhere in the described setting."],
    ["The ubiquitous flower survived for millennia, growing in just one tiny patch worldwide.", "Ubiquitous means found everywhere, not long-lived; a flower restricted to one tiny patch is not ubiquitous."],
  ],
  [
    ["The vivacious host greeted everyone with lively stories and laughter.", "Animated, lively behavior is vivacious."],
    ["Her vivacious performance brought energy and charm to the stage.", "An attractively energetic performance can be vivacious."],
    ["Her vivacious delivery conveyed accurate facts in a lifeless, unanimated monotone.", "Accuracy does not make a delivery vivacious; vivacious means lively and animated, which this delivery is not."],
  ],
  [
    ["The zealous campaigner spent every spare hour gathering support.", "Great energy in pursuit of a goal is zealous."],
    ["A zealous collector eagerly searched every stall for rare stamps.", "Enthusiastic pursuit of an interest is zealous."],
    ["He felt zealous about his friend's prize: resentful, without enthusiasm to pursue anything himself.", "Resentment of another person's prize is jealousy, not the energetic enthusiasm described by zealous."],
  ],
  [
    ["She was adept at repairing watches, even their smallest mechanisms.", "Skill at a difficult task makes someone adept."],
    ["The adept negotiator helped both sides reach an agreement.", "Effective negotiating demonstrates proficiency."],
    ["She was adept at playing chess, still unable to make a legal move.", "Someone unable to make a legal move is not yet proficient at playing chess; adept means skilled."],
  ],
  [
    ["The astute buyer spotted the hidden repair costs before making an offer.", "Accurately judging the real costs is astute."],
    ["Her astute observation revealed why customers preferred the smaller shop.", "A perceptive assessment is astute."],
    ["His astute assessment dismissed the evidence and completely misread the situation.", "An assessment that completely misreads the situation is not astute; astute judgment is accurate and perceptive."],
  ],
  [
    ["The coherent report connected each conclusion to the evidence.", "Logical connections make a report coherent."],
    ["Their separate ideas became a coherent plan with one clear purpose.", "Parts that form a unified whole are coherent."],
    ["The coherent argument filled neatly bound pages with logically incompatible claims.", "Physical binding does not make an argument coherent; its ideas must be logically consistent and connected."],
  ],
  [
    ["His enigmatic smile left everyone wondering what he knew.", "A smile that is difficult to interpret is enigmatic."],
    ["The enigmatic inscription puzzled researchers for years.", "A mysterious, hard-to-understand inscription is enigmatic."],
    ["The enigmatic message was brief, its meaning entirely clear and free of mystery.", "Brevity does not make a message enigmatic; enigmatic means mysterious or difficult to interpret."],
  ],
  [
    ["The transient rainbow disappeared within minutes.", "A short-lived rainbow is transient."],
    ["Her transient frustration passed as soon as she solved the problem.", "A feeling that lasts briefly is transient."],
    ["The transient change happened instantly and altered the landscape permanently.", "A rapid onset does not make a change transient; transient means short-lived or impermanent."],
  ],
  [
    ["The placid pony remained calm while children brushed its mane.", "An animal that is not easily upset is placid."],
    ["The placid pond lay still beneath the morning sky.", "Calm, peaceful water can be placid."],
    ["Her placid reaction expressed a reasonable complaint through sustained, intense agitation.", "Being reasonable does not make a reaction placid; placid means calm, unlike this agitated reaction."],
  ],
  [
    ["The witness gave a credible account that matched the camera footage.", "Supporting evidence makes an account believable."],
    ["The historian used credible records whose origins could be verified.", "Verifiable records can be convincing sources."],
    ["The credible story remained impossible to believe after every detail was disproved.", "A person's belief does not make a disproved story convincing or worthy of belief; credible describes the story's believability."],
  ],
  [
    ["The hikers were wary of crossing the bridge after noticing its loose boards.", "Caution about a possible danger is wary behavior."],
    ["She was wary of an offer that sounded too good to be true.", "Caution about a possible problem makes her wary."],
    ["He felt wary after lifting boxes: physically tired, without any sense of caution.", "Tired means weary; wary means cautious, a feeling the mover explicitly rules out."],
  ],
];

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function dayOfYear(date) {
  const start = new Date(date.getTime());
  start.setUTCMonth(0, 1);
  return Math.floor((date - start) / DAY_MS) + 1;
}

function mondayFor(date) {
  const monday = new Date(date.getTime());
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday;
}

function wordFor(date) {
  return DAILY_WORDS[(dayOfYear(date) - 1) % DAILY_WORDS.length];
}

function weeklyWords(date) {
  const monday = mondayFor(date);
  return Array.from({ length: 7 }, (_, offset) => wordFor(new Date(monday.getTime() + offset * DAY_MS)));
}

function getDailyVocabulary(dateText) {
  const date = parseDate(dateText);
  if (!date) return { error: "Use a real date in YYYY-MM-DD format." };
  const wordIndex = (dayOfYear(date) - 1) % DAILY_WORDS.length;
  const shift = ((Math.floor(date.getTime() / DAY_MS) % 3) + 3) % 3;
  const ordered = CONTEXTS[wordIndex].map(([text, explanation], index) => ({ text, explanation, incorrect: index === 2 }));
  const options = ordered.slice(shift).concat(ordered.slice(0, shift));
  return {
    date: dateText,
    weekStart: mondayFor(date).toISOString().slice(0, 10),
    word: { ...DAILY_WORDS[wordIndex] },
    weekWords: weeklyWords(date).map((word) => ({ ...word })),
    challenge: {
      id: `vocabulary-v1-${dateText}`,
      prompt: "Two sentences use today's word correctly. Pick the impostor.",
      options: options.map(({ text, explanation }) => ({ text, explanation })),
      answerIndex: options.findIndex((option) => option.incorrect),
    },
  };
}

module.exports = { getDailyVocabulary, parseDate, dayOfYear, mondayFor, weeklyWords };
