"use strict";

// Bounded authored curriculum, beginning Monday 2026-09-21. ponytail: This
// 28-week review loop provides 196 distinct daily words, exceeding six calendar
// months. Add reviewed families before presenting later cycles as new content.
const WEEKLY_START = "2026-09-21";
const DAY_MS = 86400000;
const { EXTRA_ROOTS, EXTRA_CONTEXTS, EXTRA_LESSONS } = require("./weekly-learning-extra");

// Root references: Merriam-Webster's etymology entries provide the Latin (or
// Greek) source checks for spect, port, struct, script, cred, dict, tract, and
// mit/miss: https://www.merriam-webster.com/dictionary/inspect
// https://www.merriam-webster.com/dictionary/transport
// https://www.merriam-webster.com/dictionary/construct
// https://www.merriam-webster.com/dictionary/describe
// https://www.merriam-webster.com/dictionary/credible
// https://www.merriam-webster.com/dictionary/predict
// https://www.merriam-webster.com/dictionary/attract
// https://www.merriam-webster.com/dictionary/transmit
function word(word, pos, def, example) { return { word, pos, def, example }; }

const ROOT_WORDS = [
  { form: "spect", meaning: "look; see", origin: "Latin specere/spectare, to look", words: [
    word("Inspect", "verb", "Examine carefully.", "The engineer will inspect the bridge before it opens."),
    word("Spectator", "noun", "A person who watches an event.", "Each spectator stayed behind the rope at the race."),
    word("Perspective", "noun", "A particular way of viewing or understanding something.", "Listening gave Maya a new perspective on the disagreement."),
    word("Circumspect", "adjective", "Careful to consider possible consequences.", "The circumspect editor checked each claim before publishing it."),
    word("Retrospective", "adjective", "Looking back on or dealing with past events.", "Their retrospective display traced the school's first twenty years."),
    word("Spectacle", "noun", "A striking or impressive public display.", "The lantern parade was a bright spectacle across the park."),
    word("Introspection", "noun", "Examination of one's own thoughts and feelings.", "Quiet introspection helped him explain why the result mattered."),
  ] },
  { form: "port", meaning: "carry", origin: "Latin portare, to carry", words: [
    word("Portable", "adjective", "Easy to carry or move.", "The portable speaker fit easily into her backpack."),
    word("Transport", "verb", "Carry people or goods from one place to another.", "Small boats transport supplies to the island."),
    word("Import", "verb", "Bring goods or services into a country from abroad.", "The shop may import paper from Japan."),
    word("Comport", "verb", "Behave or conduct oneself in a specified way.", "The ambassador must comport herself with care at the ceremony."),
    word("Portage", "noun", "The carrying of a boat or supplies over land between waterways.", "The paddlers carried their canoe over a short portage."),
    word("Report", "noun", "An organized account of facts or findings.", "Her report explained the survey results clearly."),
    word("Porter", "noun", "A person employed to carry luggage or supplies.", "The porter carried our bags to the train."),
  ] },
  { form: "struct", meaning: "build", origin: "Latin struere/structus, to build", words: [
    word("Construct", "verb", "Build or form by putting parts together.", "The class will construct a model bridge from cardboard."),
    word("Structure", "noun", "The arrangement of parts in a whole.", "The essay's structure made its argument easy to follow."),
    word("Instruct", "verb", "Direct or teach someone how to do something.", "The coach will instruct the team on the new drill."),
    word("Obstruct", "verb", "Block or get in the way of.", "Fallen branches obstructed the narrow path."),
    word("Superstructure", "noun", "A structure built on top of another structure or foundation.", "The bridge's steel superstructure rests on concrete piers."),
    word("Reconstruct", "verb", "Build or form again from evidence or remains.", "Archaeologists reconstruct the vessel from its fragments."),
    word("Infrastructure", "noun", "The basic systems and structures needed for a place to function.", "Safe water pipes are essential infrastructure for a town."),
  ] },
  { form: "scrib/script", meaning: "write", origin: "Latin scribere/scriptus, to write", words: [
    word("Describe", "verb", "Give an account of what someone or something is like.", "Please describe the bird's colors in your notebook."),
    word("Manuscript", "noun", "An author's written or typed work before publication.", "The editor returned the manuscript with helpful notes."),
    word("Transcript", "noun", "A written record of spoken words or academic results.", "The hearing transcript recorded every question and answer."),
    word("Script", "noun", "The written text for a play, film, or broadcast.", "The actors marked pauses in the script."),
    word("Circumscribe", "verb", "Draw a line around; strictly limit.", "The rules circumscribe how the grant may be spent."),
    word("Prescribe", "verb", "Officially recommend or order a treatment or rule.", "Only a qualified clinician may prescribe that medicine."),
    word("Inscription", "noun", "Words written or carved on an object.", "The inscription on the medal named its recipient."),
  ] },
  { form: "cred", meaning: "believe; trust", origin: "Latin credere, to believe", words: [
    word("Credibility", "noun", "The quality of being believable or worthy of trust.", "The matching records strengthened the witness account's credibility."),
    word("Credence", "noun", "Belief in something as true.", "The documents gave credence to the historian's claim."),
    word("Credential", "noun", "Evidence of a person's qualifications or identity.", "Her teaching credential confirmed that she had completed the training."),
    word("Discredit", "verb", "Cause people to stop believing in something.", "The altered photo could discredit an otherwise sound report."),
    word("Incredulous", "adjective", "Unwilling or unable to believe something.", "He was incredulous when the tiny seed grew into a tall tree."),
    word("Credo", "noun", "A statement of beliefs or guiding principles.", "The club's credo asks members to leave every place cleaner."),
    word("Accredit", "verb", "Officially recognize that an organization meets a standard.", "The board can accredit a school after its review."),
  ] },
  { form: "dict", meaning: "say; speak", origin: "Latin dicere/dictus, to say", words: [
    word("Predict", "verb", "Say what is likely to happen in the future.", "The meteorologist can predict rain from the moving clouds."),
    word("Dictate", "verb", "Say words aloud for someone else to write down.", "The teacher will dictate the sentence slowly."),
    word("Verdict", "noun", "A formal decision or judgment.", "The jury announced its verdict after reviewing the evidence."),
    word("Contradict", "verb", "Assert the opposite of a statement.", "The new evidence may contradict the first explanation."),
    word("Benediction", "noun", "A blessing or expression of good wishes.", "The ceremony ended with a short benediction."),
    word("Diction", "noun", "The choice and use of words in speech or writing.", "Her precise diction made the instructions easy to understand."),
    word("Valediction", "noun", "An act or expression of saying farewell.", "The head student offered a warm valediction at graduation."),
  ] },
  { form: "tract", meaning: "draw; pull", origin: "Latin trahere/tractus, to draw or pull", words: [
    word("Attract", "verb", "Draw someone or something toward a place or thing.", "Bright flowers attract bees to the garden."),
    word("Contract", "verb", "Become smaller or tighter.", "Metal can contract slightly as it cools in the evening air."),
    word("Extract", "verb", "Remove or take out, often with effort.", "The dentist will extract the damaged tooth."),
    word("Distract", "verb", "Draw attention away from something.", "A buzzing phone can distract a reader from a chapter."),
    word("Protract", "verb", "Make something last longer than necessary.", "Repeated arguments can protract a simple meeting."),
    word("Retract", "verb", "Draw back or take back a statement.", "The newspaper had to retract its inaccurate claim."),
    word("Traction", "noun", "The gripping power between a surface and an object.", "The rough soles gave the hikers traction on wet stone."),
  ] },
  { form: "mit/miss", meaning: "send", origin: "Latin mittere/missus, to send", words: [
    word("Emit", "verb", "Send out or give off.", "The lamp will emit a soft light at dusk."),
    word("Transmit", "verb", "Send a signal, message, or disease from one place or person to another.", "The radio tower can transmit emergency updates."),
    word("Dismiss", "verb", "Send away or allow to leave.", "The principal will dismiss the assembly after the announcement."),
    word("Mission", "noun", "An important task or purpose.", "The rescue team's mission was to find the lost hikers."),
    word("Omission", "noun", "Something left out or not included.", "The missing date was an omission from the report."),
    word("Permit", "verb", "Allow something to happen.", "The rules permit bicycles on this path."),
    word("Intermission", "noun", "A pause between parts of a performance or event.", "During the intermission, the audience stretched their legs."),
  ] },
];

ROOT_WORDS.push(...EXTRA_ROOTS);

// The second use and impostor are authored separately from the DTO words so
// clients keep receiving the compact { word, pos, def, example } contract.
const WEEKLY_CONTEXTS = {
  Inspect: ["Before signing, Niran inspected the bicycle for loose brakes.", "Checking carefully for faults is inspecting.", "Niran inspected the bicycle by riding away without looking at it.", "Leaving without examining it is not inspecting."],
  Spectator: ["A spectator cheered from the stands instead of joining the game.", "A spectator watches rather than takes part.", "The spectator scored the winning goal on the field.", "A player in the game is not a spectator."],
  Perspective: ["From a younger child's perspective, the instructions seemed confusing.", "Perspective is a particular viewpoint.", "Her perspective was the exact number of pencils in the box.", "A count is not a way of viewing an issue."],
  Circumspect: ["The circumspect class checked the weather and route before hiking.", "Considering consequences shows circumspection.", "He was circumspect because he posted the address before thinking.", "Publishing first without considering consequences is not circumspect."],
  Retrospective: ["The retrospective article compared this season with last year's.", "Retrospective work looks back at past events.", "A retrospective forecast described only next month's weather.", "A forecast looks forward, not back."],
  Spectacle: ["The fireworks became a spectacle that drew the whole neighborhood outside.", "A striking public display is a spectacle.", "The spectacle was a private thought no one could see.", "A private thought is not a public display."],
  Introspection: ["After the argument, Sam used introspection to consider his own reaction.", "Introspection examines one's own thoughts.", "Her introspection meant asking strangers to judge her feelings.", "Outsourcing judgment to others is not self-examination."],
  Portable: ["The portable microscope could travel from classroom to classroom.", "Something easy to carry is portable.", "The portable statue was fixed permanently to the floor.", "A fixed object cannot be carried easily."],
  Transport: ["A van transports the library books to the village each week.", "Transport carries people or goods between places.", "The van transported the books by leaving them in the same room.", "Nothing is carried to another place in that situation."],
  Import: ["Thailand may import a tool that is not made locally.", "Import brings goods into a country.", "The company imported tea by sending it out of the country.", "Sending goods out is exporting, not importing."],
  Comport: ["During the debate, Arin comported himself with patience and respect.", "Comport means behave or conduct oneself.", "The suitcase comported itself onto the luggage cart.", "A suitcase does not behave or conduct itself."],
  Portage: ["The group used a portage to carry the kayak around the waterfall.", "Portage is carrying a boat or supplies over land.", "Their portage floated the canoe downstream without anyone carrying it.", "Floating on water is not a land carry."],
  Report: ["The science report carried the team's findings back to the class.", "A report gives an organized account of findings.", "The report was a pile of unrelated notes with no findings explained.", "Unorganized notes do not form a report."],
  Porter: ["The porter moved the camping supplies from the bus to the lodge.", "A porter carries luggage or supplies for others.", "The porter watched the luggage while someone else carried every bag.", "Watching rather than carrying does not make someone a porter."],
  Construct: ["The students constructed a shelter by joining the panels together.", "Construct means build from parts.", "They constructed the shelter by taking every panel apart and leaving none joined.", "Taking parts apart does not build a shelter."],
  Structure: ["Headings gave the research paper a clear structure.", "Structure is the arrangement of parts in a whole.", "The paper's structure was a random collection with no arrangement.", "A random collection lacks structure."],
  Instruct: ["The lifeguard instructed swimmers to leave the pool during thunder.", "Instruct means give directions or teach how to act.", "The lifeguard instructed swimmers by refusing to give any directions.", "Refusing to direct people is not instructing."],
  Obstruct: ["A fallen tree obstructed the road until workers moved it.", "Obstruct means block a path or process.", "The tree obstructed the road by clearing it completely.", "Clearing a road removes an obstruction."],
  Superstructure: ["Engineers inspected the bridge's steel superstructure above the piers.", "A superstructure is built above a foundation or lower structure.", "The superstructure was the soil underneath the bridge foundation.", "Soil below a foundation is not a superstructure."],
  Reconstruct: ["Using photographs, the museum reconstructed the broken vase.", "Reconstruct means build again from evidence or remains.", "The museum reconstructed the vase by throwing away every fragment.", "Discarding the evidence prevents reconstruction."],
  Infrastructure: ["Reliable roads and clean water pipes are vital infrastructure.", "Infrastructure is the basic system a community needs to function.", "A single party balloon was the town's entire infrastructure.", "One decoration is not a basic operating system."],
  Describe: ["Lina described the animal's striped tail and bright eyes.", "Describe gives an account of what something is like.", "Lina described the animal by naming no features at all.", "Giving no account is not describing."],
  Manuscript: ["The author sent her manuscript to the editor before the book was printed.", "A manuscript is an author's work before publication.", "The manuscript was a finished shelf of printed books in a shop.", "Published copies are not a pre-publication manuscript."],
  Transcript: ["The transcript recorded each speaker's words from the meeting.", "A transcript is a written record of speech or results.", "The transcript was a painting inspired by the meeting.", "A painting is not a written record."],
  Script: ["The actors highlighted their lines in the play's script.", "A script is written text for a performance.", "The script was the audience's applause after the play.", "Applause is not written performance text."],
  Circumscribe: ["The grant rules circumscribe which materials the team may buy.", "Circumscribe can mean strictly limit.", "The rules circumscribed spending by allowing every purchase without limit.", "Unlimited permission is not a limit."],
  Prescribe: ["The doctor may prescribe medicine after examining a patient.", "Prescribe means officially recommend or order treatment.", "The doctor prescribed medicine by asking the patient to choose blindly.", "A qualified official recommendation needs judgment, not a blind choice."],
  Inscription: ["An inscription on the plaque named the garden's donor.", "An inscription is words written or carved on an object.", "The inscription was a tune played by the fountain.", "Music is not written or carved words."],
  Credibility: ["The independent sources gave the report greater credibility.", "Agreement among reliable sources makes the report more believable.", "The report gained credibility when its author admitted inventing every source.", "Inventing the evidence undermines rather than strengthens believability."],
  Credence: ["The matching records gave credence to the old map.", "Credence is belief supported by reasons.", "The records gave credence to the map by proving it was invented yesterday.", "Proof against a claim removes credence."],
  Credential: ["Her first-aid credential showed she had completed the course.", "A credential is evidence of qualification or identity.", "Her credential was a guess from someone who had never met her.", "A guess is not verified evidence of qualification."],
  Discredit: ["The corrected data could discredit the rumor online.", "Discredit causes people to stop believing a claim.", "The data discredited the rumor by proving every part accurate.", "Proof of accuracy supports rather than discredits."],
  Incredulous: ["The audience was incredulous when the magician revealed the empty box.", "Incredulous means unable or unwilling to believe.", "She was incredulous because she accepted the surprising story instantly.", "Immediate acceptance is the opposite of incredulity."],
  Credo: ["The team's credo was: prepare carefully and share the credit.", "A credo states guiding beliefs or principles.", "Their credo was the color of the team bus.", "A color is not a statement of beliefs."],
  Accredit: ["The review board can accredit a program that meets its standards.", "Accredit means officially recognize that standards are met.", "The board accredited the program without reviewing any standards.", "Official recognition depends on checking standards."],
  Predict: ["The class predicted that ice would melt in the warm sun.", "Predict says what is likely to happen later.", "They predicted yesterday's weather after reading the old report.", "Reporting an already-known past event is not predicting."],
  Dictate: ["Ms. Dao dictated the spelling words while students wrote them down.", "Dictate means say words aloud for someone else to write.", "Ms. Dao dictated by silently reading the list to herself.", "Silent private reading does not provide words for others to write."],
  Verdict: ["After discussion, the judges announced their verdict.", "A verdict is a formal decision or judgment.", "The verdict was an unfinished question with no decision.", "An unanswered question is not a judgment."],
  Contradict: ["The second measurement contradicted the first result.", "Contradict means assert or show the opposite.", "The measurement contradicted the first result by matching it exactly.", "An exact match does not oppose the first result."],
  Benediction: ["The assembly ended with a benediction wishing everyone safe travels.", "A benediction is a blessing or expression of good wishes.", "The benediction was a warning that wished harm on the audience.", "A wish for harm is not a blessing."],
  Diction: ["Her careful diction made the directions easy to understand.", "Diction is the choice and use of words.", "His diction was the size of the letters on the poster.", "Letter size is typography, not word choice."],
  Valediction: ["At graduation, the class president offered a valediction to the teachers.", "A valediction is an expression of farewell.", "The valediction welcomed everyone to the first day of school.", "A welcome begins an occasion; a valediction says goodbye."],
  Attract: ["The flowering basil attracts butterflies to the garden.", "Attract means draw toward.", "The flowers attracted butterflies by driving them farther away.", "Driving away does not draw toward."],
  Contract: ["The metal rod contracted slightly as it cooled.", "Contract can mean become smaller or tighter.", "The rod contracted by becoming twice as long.", "Growing longer is expansion, not contraction."],
  Extract: ["The researcher extracted the useful facts from the long article.", "Extract means take out from a larger whole.", "She extracted the facts by adding unrelated pages to the article.", "Adding material does not remove facts."],
  Distract: ["The loud construction distracted Jin from his reading.", "Distract draws attention away from a task.", "The noise distracted Jin by helping him focus more deeply on every page.", "Improved focus is not distraction."],
  Protract: ["Repeating the same point can protract a meeting.", "Protract means make something last longer.", "The chair protracted the meeting by ending it ten minutes early.", "Ending early shortens rather than prolongs."],
  Retract: ["The newspaper retracted its incorrect headline the next day.", "Retract means take back a statement.", "The paper retracted the headline by repeating it as certain.", "Repeating a claim is not taking it back."],
  Traction: ["The new tires gave the bicycle traction on the wet road.", "Traction is gripping power between surfaces.", "The tires had traction because they slid without any grip.", "Sliding without grip shows a lack of traction."],
  Emit: ["The small lamp emits enough light to read by.", "Emit means send out or give off.", "The lamp emitted light by absorbing every ray and releasing none.", "Releasing none is not emitting."],
  Transmit: ["The station transmits a weather warning to nearby phones.", "Transmit sends a signal or message from one place to another.", "The station transmitted the warning by keeping it only on an unplugged computer.", "A message kept in one place is not transmitted."],
  Dismiss: ["The teacher dismissed the class after all questions were answered.", "Dismiss means send away or allow to leave.", "The teacher dismissed the class by locking everyone in the room.", "Keeping people from leaving is not dismissing them."],
  Mission: ["The volunteers' mission was to collect litter from the beach.", "A mission is an important task or purpose.", "Their mission was the color of the collection bags.", "A color is not a task or purpose."],
  Omission: ["Leaving the source name out was an omission from the bibliography.", "An omission is something left out.", "The omission was every detail included twice in the bibliography.", "Included details are not omissions."],
  Permit: ["The sign permits visitors to use the path until sunset.", "The sign allows visitors to use the path, so permit fits.", "The sign permitted visitors by clearly forbidding entry.", "Forbidding entry does not allow it."],
  Intermission: ["During the intermission, the audience bought water before the second act.", "An intermission is a pause between parts of an event.", "The intermission was the uninterrupted final hour of the play.", "An uninterrupted part is not a pause."],
};

Object.assign(WEEKLY_CONTEXTS, EXTRA_CONTEXTS);

const QUOTES = {
  integrity: ["Tell the truth before it becomes difficult.", "A promise grows stronger when nobody is checking.", "Fair work leaves room for everyone to stand tall.", "Own the mistake, then help repair its result.", "Character appears in the choices we could hide.", "Honesty makes a small answer useful.", "Keep your word when convenience asks you not to."],
  collaboration: ["A shared plan becomes clearer when every voice is heard.", "Good teamwork makes space for another person's best idea.", "Ask for help early enough to build together.", "A group succeeds when credit travels around the circle.", "Listening is work that moves a team forward.", "Bring your part, then notice what the whole needs.", "We solve bigger problems when we trade guesses for questions."],
  creativity: ["A first draft is a door, not a verdict.", "Curiosity gives ordinary objects a second life.", "Try the strange idea gently before calling it impossible.", "Make room for mistakes that teach the next version.", "A new angle can begin with one careful question.", "Imagination grows when we notice what others pass by.", "Build something small enough to learn from today."],
  kindness: ["Kindness notices the person standing just outside the circle.", "A patient answer can make a hard day lighter.", "Offer help in a way that keeps another person's dignity.", "Small care becomes visible when it arrives on time.", "Speak about people as if they can hear you.", "Include someone before they have to ask.", "Gentleness is strength with attention attached."],
};
const THEMES = Object.keys(QUOTES);

const LESSON_DETAILS = {
  spect: {
    1: { explanation: "Tone meter: spectator is neutral (a watcher); circumspect is positive when it means wisely careful; spectacle can be positive for an impressive event but negative when it suggests showy attention. Choose the surrounding situation before choosing the word.", examples: ["Neutral: Every spectator waited for the race.", "Positive: A circumspect planner checks safety first.", "Potentially negative: The argument became an embarrassing spectacle."], grammar: { title: "Word in the Mechanics", explanation: "A spectator is singular, so use a singular verb. Correct: “Each spectator was quiet.” Incorrect: “Each spectator were quiet.”", example: "Each spectator was quiet until the runners arrived." } },
    2: { explanation: "Synonym spectrum: inspect means examine for condition or faults; observe means watch without necessarily judging; scrutinize means inspect with especially close attention. A spectator observes, while an inspector scrutinizes.", examples: ["Inspect the helmet for cracks.", "Observe the birds without disturbing them.", "Scrutinize the chart before announcing a result."] },
    3: { explanation: "Prefix check: in- in inspect points inward, while retro- in retrospective points backward in time. Neither turns spect into a simple opposite. An antonym of circumspect in this context is reckless: careful planning versus ignoring consequences.", examples: ["Inspect the inside of the case.", "A retrospective looks back at last term.", "Reckless choices skip consequence-checking."] },
    4: { explanation: "Academic register: retrospective is common in museum, research, and project writing; everyday speech usually says “looking back.” Use the formal word when a careful review of past work is the point.", examples: ["Formal: The team wrote a retrospective on the trial.", "Everyday: The team looked back at the trial."] },
  },
  port: {
    1: { explanation: "Tone meter: portable is neutral and practical; transport is neutral but technical; comport is formal and often evaluates behavior. “Portable lunch” is ordinary, while “comport yourself calmly” sounds more formal.", examples: ["Neutral: Bring a portable charger.", "Technical: Trucks transport supplies.", "Formal: She comported herself calmly."], grammar: { title: "Word in the Mechanics", explanation: "Import is a verb here, so it needs an object. Correct: “They import paper.” Incorrect: “They import from paper.”", example: "The shop imports paper from a nearby country." } },
    2: { explanation: "Synonym spectrum: carry is broad; transport usually carries people or goods between places; portage specifically carries a boat or supplies over land. Pick portage only for that waterway-to-land situation.", examples: ["Carry the box upstairs.", "Transport the books by van.", "Portage the canoe around the rapids."] },
    3: { explanation: "Prefix check: im- in import means into, while ex- in export means out. They form a directional pair, not a good-versus-bad pair. Portable has no opposing prefix; its useful antonym is fixed or immovable.", examples: ["Import goods into a country.", "Export goods out of a country.", "A fixed sculpture is not portable."] },
    4: { explanation: "Academic register: portage is a specialized geographic and travel term for carrying a boat or supplies over land between waterways. Use it when the land crossing itself matters, rather than for every act of carrying.", examples: ["Formal: The route requires a short portage.", "Everyday: We must carry the canoe over land for a short distance."] },
  },
  struct: {
    1: { explanation: "Tone meter: structure is neutral; instruct is helpful when guidance is wanted; obstruct is negative because it blocks progress. The shared root is about building, but the prefixes change the relationship to that building.", examples: ["Neutral: The essay has a clear structure.", "Helpful: Instruct the group before starting.", "Negative: A branch obstructed the trail."], grammar: { title: "Word in the Mechanics", explanation: "Infrastructure is singular as a system. Correct: “The infrastructure is aging.” Incorrect: “The infrastructure are aging.”", example: "The town's water infrastructure is essential." } },
    2: { explanation: "Synonym spectrum: construct means build by joining parts; assemble means put prepared parts together; reconstruct means build again from evidence. Reconstruct carries the extra idea of restoration.", examples: ["Construct a bridge model.", "Assemble the kit from its pieces.", "Reconstruct the vase from fragments."] },
    3: { explanation: "Prefix check: re- in reconstruct means again; ob- in obstruct means against or in the way. They are not logical opposites. A practical antonym pair is construct versus demolish: build versus tear down.", examples: ["Reconstruct the damaged wall.", "Obstruct the doorway with a crate.", "Demolish the unsafe shed."] },
    4: { explanation: "Academic register: superstructure is a technical architecture or social-science word for a structure built above a base. Everyday speech usually says “the upper part of the bridge.”", examples: ["Formal: Inspect the bridge superstructure.", "Everyday: Inspect the bridge's upper structure."] },
  },
  "scrib/script": {
    1: { explanation: "Tone meter: describe is neutral; prescribe is formal and authoritative; circumscribe is formal and limiting. The words all concern writing, but their tone depends on whether someone is explaining, ordering, or setting boundaries.", examples: ["Neutral: Describe the bird.", "Authoritative: A clinician may prescribe medicine.", "Formal: Rules circumscribe spending."], grammar: { title: "Word in the Mechanics", explanation: "Describe takes an object. Correct: “Describe the pattern.” Incorrect: “Describe about the pattern.”", example: "Describe the pattern in one clear sentence." } },
    2: { explanation: "Synonym spectrum: script is text for performance; manuscript is an author's unpublished work; transcript is a written record of spoken words. Their common root does not make them interchangeable.", examples: ["Actors read a script.", "An editor reviews a manuscript.", "A transcript records the hearing."] },
    3: { explanation: "Prefix check: pre- in prescribe means before, while circum- in circumscribe means around. Neither is a simple negative prefix. A useful antonym pair is inscribe and erase: write on a surface versus remove the writing.", examples: ["Prescribe a treatment after assessment.", "Circumscribe the area with a line.", "Erase the inscription from the board."] },
    4: { explanation: "Academic register: circumscribe is a formal verb for strictly limiting; everyday speech usually says “limit.” Use it in policy or research writing when the boundary itself matters.", examples: ["Formal: The policy circumscribes spending.", "Everyday: The policy limits spending."] },
  },
  cred: {
    1: { explanation: "Tone meter: credible is positive because evidence supports belief; incredulous is skeptical surprise, not dishonesty; discredit is negative because it undermines trust. Evidence decides which word fits.", examples: ["Positive: The source is credible.", "Surprised: We were incredulous at the result.", "Negative: False data can discredit a report."], grammar: { title: "Word in the Mechanics", explanation: "Credible is an adjective, so use it before a noun or after be. Correct: “The account is credible.” Incorrect: “The account credibly.”", example: "The account is credible because records support it." } },
    2: { explanation: "Synonym spectrum: credible means believable; reliable means consistently dependable; plausible means seeming reasonable but not yet proved. A plausible idea may still need evidence to become credible.", examples: ["The video is credible evidence.", "The clock is reliable every day.", "The explanation is plausible but untested."] },
    3: { explanation: "Prefix check: dis- in discredit means away from or the reverse of giving credit; in- in incredulous signals not believing. They are different historical formations, not a rule for every word beginning in- or dis-. A clear antonym pair is credible versus unbelievable.", examples: ["Evidence can discredit a rumor.", "He was incredulous at the claim.", "A disproved claim is unbelievable."] },
    4: { explanation: "Academic register: incredulous is a formal adjective for someone unable or unwilling to believe. Everyday speech often says “unable to believe it.” Distinguish incredulous, the person's reaction, from incredible, the surprising thing.", examples: ["Formal: The researcher was incredulous at the result.", "Everyday: The researcher could hardly believe the result."] },
  },
  dict: {
    1: { explanation: "Tone meter: dictate can be neutral in a spelling exercise but forceful in a power relationship; contradict is neutral when evidence disagrees but can sound confrontational in conversation; benediction is warmly formal.", examples: ["Neutral: Dictate the spelling words.", "Evidence: The data contradict the guess.", "Warmly formal: The ceremony ended with a benediction."], grammar: { title: "Word in the Mechanics", explanation: "The plural subject data takes a plural verb in formal writing. Correct: “The data contradict the claim.” Incorrect: “The data contradicts the claim.”", example: "The data contradict the first prediction." } },
    2: { explanation: "Synonym spectrum: predict says what may happen; forecast is a prediction based on patterns; prophesy often carries religious or dramatic tone. Use predict for an ordinary evidence-based claim.", examples: ["Predict rain from the clouds.", "Forecast rain from weather models.", "The story's oracle prophesied a change."], },
    3: { explanation: "Prefix check: contra- in contradict means against, while bene- in benediction means good or well. These are directional or evaluative Latin elements, not a blanket rule for prefixes. A clear antonym pair is agree versus contradict.", examples: ["Two accounts contradict each other.", "A benediction offers good wishes.", "The witnesses agree on the time."] },
    4: { explanation: "Academic register: benediction is a formal, less-common noun for a blessing; everyday speech usually says “good wishes” or “a blessing.”", examples: ["Formal: The principal offered a benediction.", "Everyday: The principal offered good wishes."] },
  },
  tract: {
    1: { explanation: "Tone meter: attract is neutral or positive; distract often signals an unwanted loss of focus; protract is formal and mildly negative when delay is frustrating. Context tells whether drawing attention helps or harms.", examples: ["Positive: Flowers attract bees.", "Unwanted: Notifications distract readers.", "Formal: Delays protract the meeting."], grammar: { title: "Word in the Mechanics", explanation: "Retract needs the statement being taken back. Correct: “They retracted the claim.” Incorrect: “They retracted from the claim.”", example: "The paper retracted the inaccurate claim." } },
    2: { explanation: "Synonym spectrum: attract draws toward; lure suggests an invitation or temptation; distract draws attention away. The direction of attention separates attract from distract.", examples: ["Flowers attract bees.", "The sign lured visitors inside.", "The alarm distracted the speaker."] },
    3: { explanation: "Prefix check: re- in retract means back, while dis- in distract means apart or away. They do not make a neat opposite pair. A true contrast is contract versus expand: become smaller versus become larger.", examples: ["Retract an incorrect statement.", "Distract attention from reading.", "Metal expands when heated."] },
    4: { explanation: "Academic register: protract is a formal verb for making a process last longer; everyday speech usually says “drag out” or “make longer.”", examples: ["Formal: Appeals can protract the case.", "Everyday: Appeals can drag the case out."] },
  },
  "mit/miss": {
    1: { explanation: "Tone meter: emit is technical and neutral; dismiss can be neutral when class ends but negative when a concern is brushed aside; omission is formal and points to what is missing.", examples: ["Technical: The sensor emits light.", "Neutral: Dismiss the class at noon.", "Formal: Note the omission in the report."], grammar: { title: "Word in the Mechanics", explanation: "Omission is a countable noun here, so use an article. Correct: “It was an omission.” Incorrect: “It was omission.”", example: "The missing source was an omission in the report." } },
    2: { explanation: "Synonym spectrum: emit sends something out; transmit sends it from one place to another; release is a broad everyday verb for letting something out. A lamp emits light, while a tower transmits a signal.", examples: ["The lamp emits light.", "The tower transmits a signal.", "Open the gate to release the dog."] },
    3: { explanation: "Prefix check: trans- in transmit means across, while inter- in intermission means between. They describe relationships in space or time, not opposites. A practical antonym pair is permit versus forbid: allow versus refuse permission.", examples: ["Transmit a message across town.", "An intermission comes between acts.", "The rules forbid climbing the fence."] },
    4: { explanation: "Academic register: omission is a formal noun for something left out; everyday speech usually says “something missing.” It fits reports, citations, and careful review.", examples: ["Formal: The citation omission affected the report.", "Everyday: A citation was missing from the report."] },
  },
};

Object.assign(LESSON_DETAILS, EXTRA_LESSONS);

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
function mondayFor(date) { const monday = new Date(date); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7); return monday; }
function dateText(date) { return date.toISOString().slice(0, 10); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function lessonFor(root, anchor, day) {
  const titles = ["Mother Root & Anchor Word", "Tone & Connotation Meter", "Synonym Spectrum & Splitter", "Antonym & Prefix Inversion", "High-Register Academic Rare Word", "Root Field Review", "Weekly Root Retrieval"];
  const focuses = ["Meet the root and its anchor word.", "Compare tone and grammar in use.", "Separate near-synonyms precisely.", "Test real opposites and directional prefixes.", "Compare academic and everyday register.", "Review the root family across contexts.", "Retrieve and connect the week's words."];
  const details = LESSON_DETAILS[root.form][day];
  const review = day === 5
    ? { explanation: `Root field review: ${root.form} carries “${root.meaning}.” Sort ${root.words.slice(0, 5).map(({ word }) => word.toLowerCase()).join(", ")} by what each adds to the root; then explain one prefix or suffix in your own words.`, examples: [anchor.example, `Use ${anchor.word.toLowerCase()} in a new sentence that still connects to ${root.meaning}.`] }
    : { explanation: `Weekly root retrieval: write the seven ${root.form} words from memory, then check which one best fits a new context. The root suggests “${root.meaning},” but the whole word supplies the precise meaning.`, examples: [anchor.example, `Choose ${anchor.word.toLowerCase()} only when its full definition fits the context.`] };
  const content = details || (day === 0
    ? { explanation: `Mother root: ${root.form} comes from ${root.origin}. Its core idea is “${root.meaning}.” Start with ${anchor.word.toLowerCase()}, then notice how the week's other forms keep or redirect that core idea.`, examples: [anchor.example, `Say the root ${root.form}, its meaning “${root.meaning},” and the anchor word ${anchor.word.toLowerCase()}.`] }
    : review);
  const lesson = { title: titles[day], focus: focuses[day], explanation: content.explanation, examples: content.examples };
  if (content.grammar) lesson.grammar = content.grammar;
  return lesson;
}

function getWeeklyLearning(dateTextValue) {
  const date = parseDate(dateTextValue);
  if (!date || date.getTime() < Date.parse(`${WEEKLY_START}T00:00:00.000Z`)) return null;
  const monday = mondayFor(date);
  const weeks = Math.floor((monday.getTime() - Date.parse(`${WEEKLY_START}T00:00:00.000Z`)) / (7 * DAY_MS));
  const day = Math.floor((date.getTime() - monday.getTime()) / DAY_MS);
  const root = ROOT_WORDS[((weeks % ROOT_WORDS.length) + ROOT_WORDS.length) % ROOT_WORDS.length];
  const theme = THEMES[((weeks % THEMES.length) + THEMES.length) % THEMES.length];
  return clone({ weekStart: dateText(monday), theme, root: { form: root.form, meaning: root.meaning, origin: root.origin }, quote: { text: QUOTES[theme][day], author: "Fam ETC", theme, weekStart: dateText(monday) }, lesson: lessonFor(root, root.words[day], day), word: root.words[day], weekWords: root.words });
}

function getWeeklyContexts(wordValue) {
  const context = WEEKLY_CONTEXTS[wordValue.word];
  if (!context) throw new Error(`Missing weekly vocabulary contexts for ${wordValue.word}.`);
  return [
    [wordValue.example, `This uses ${wordValue.word.toLowerCase()} correctly: ${wordValue.def}`],
    [context[0], context[1]],
    [context[2], context[3]],
  ];
}

module.exports = { WEEKLY_START, ROOT_WORDS, getWeeklyLearning, getWeeklyContexts };
