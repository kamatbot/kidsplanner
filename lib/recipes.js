"use strict";
/**
 * Recipes — the seed recipe library for Meals (docs/MEALS-PLAN.md §8b).
 * Pure data + pure helpers: NO db, NO network, NO route code, no other lib
 * requires. This is what makes M1/M2 useful with the AI planner switched off
 * entirely, and it's the deterministic fallback/filter layer M3's AI planner
 * sits on top of (§6: allergens are enforced HERE, never trusted to the model).
 *
 * Deliberately over-indexed on Indian and Thai (Bangkok household, Indian
 * kitchen — owner decision 2026-08-01, see MEALS-PLAN.md §8b).
 *
 * Ingredient `category` is the same controlled set as the pantry (§3):
 * produce|protein|dairy|grain|pantry|frozen|spice|other.
 * `core: true` means the dish is not itself without that ingredient (toor dal
 * for dal tadka; not the coriander garnish on top of it).
 * `allergens` are drawn from a small controlled set: dairy, peanut, treenut,
 * sesame, soy, gluten, egg, fish, shellfish — this feeds the deterministic
 * §6 filter, so accuracy here is a safety property, not decoration. Fish
 * sauce and shrimp paste are FISH/SHELLFISH — most Thai dishes are not `veg`
 * because of them even when they contain no meat.
 */

// ---------- controlled vocabularies (exported so callers/tests can validate against them) ----------

const CUISINES = ["indian", "thai", "other"];
const SLOTS = ["breakfast", "lunch", "dinner", "snack"]; // "snack" is recipe-only — menu planning still plans the three meals (lib/meals.js SLOTS)
const INGREDIENT_CATEGORIES = ["produce", "protein", "dairy", "grain", "pantry", "frozen", "spice", "other"];
const ALLERGENS = ["dairy", "peanut", "treenut", "sesame", "soy", "gluten", "egg", "fish", "shellfish"];

// ---------- name normalisation ----------
// Indian/Thai ingredient naming varies a lot (aloo/potato, nam pla/fish
// sauce, cilantro/coriander/dhania) — this is what makes coverage/suggest
// matching actually work instead of only matching identical strings.

function normalizeBase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// Light, deterministic singularizer — doesn't need to produce real words,
// only to fold plural and singular ingredient names to the SAME token on
// both the pantry side and the recipe side.
function singularizeWord(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("oes")) return w.slice(0, -2); // tomatoes -> tomato, potatoes -> potato
  if (w.endsWith("ies")) return w.slice(0, -3) + "y"; // curries -> curry
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2); // dishes -> dish
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1); // chilies-stem -> chili-stem
  return w;
}

function normalize(s) {
  return normalizeBase(s)
    .split(" ")
    .filter(Boolean)
    .map(singularizeWord)
    .join(" ");
}

// canonical term -> alternate spellings/regional names. Exported so callers
// (and tests) can see exactly what's unified. Every group's alias phrases
// are run through the SAME normalize() as pantry/ingredient names at lookup
// time, so plurals ("chilies") fold onto the same key as the singular form
// without needing to be listed here individually.
const SYNONYMS = {
  coriander: ["cilantro", "dhania", "coriander leaves", "cilantro leaves", "fresh coriander"],
  chili: [
    "chilli", "chile", "green chili", "red chili", "green chilli", "red chilli", "thai chili", "bird's eye chili",
    // explicit plural spellings — "chili"'s plural doesn't follow the
    // generic consonant+y -> ies stemmer rule (it isn't "chily"), so these
    // need to be listed rather than relying on singularizeWord to derive them.
    "chilies", "chillies", "chiles", "chilis",
  ],
  eggplant: ["aubergine", "brinjal", "baingan"],
  curd: ["yogurt", "yoghurt", "dahi", "plain yogurt"],
  chickpea: ["garbanzo", "chana", "kabuli chana", "garbanzo bean", "chickpeas"],
  "spring onion": ["scallion", "green onion", "scallions", "spring onions"],
  shrimp: ["prawn", "prawns"],
  peanut: ["groundnut", "groundnuts", "peanuts"],
  "toor dal": ["arhar dal", "tur dal", "toovar dal", "split pigeon peas", "pigeon pea"],
  "coconut milk": ["coconut cream", "canned coconut milk", "tinned coconut milk"],
  potato: ["aloo", "potatoes"],
  onion: ["pyaz", "onions"],
  ginger: ["adrak", "ginger root"],
  garlic: ["lahsun", "garlic cloves"],
  "mung bean": ["moong", "moong dal", "green gram", "split moong dal"],
  "urad dal": ["black gram", "split black lentil", "white urad dal"],
  "kidney beans": ["rajma", "red kidney beans"],
  "glass noodles": ["vermicelli", "cellophane noodles", "mung bean noodles", "glass noodle"],
  "rice noodles": ["rice stick noodles", "sen lek", "pad thai noodles", "flat rice noodles"],
  "fish sauce": ["nam pla"],
  "palm sugar": ["coconut sugar"],
  galangal: ["kha"],
  lemongrass: ["takrai", "lemon grass"],
  "kaffir lime leaves": ["makrut lime leaves", "kaffir lime leaf", "lime leaves"],
  "holy basil": ["krapao", "bai kaprao", "thai holy basil"], // NOT the same herb as Thai basil
  "thai basil": ["horapa", "sweet basil"],
  "shrimp paste": ["kapi", "belacan"],
  "dried shrimp": ["goong haeng", "dried shrimps"],
  tamarind: ["tamarind paste", "tamarind pulp", "imli"],
  paneer: ["indian cottage cheese", "paneer cheese"],
  besan: ["gram flour", "chickpea flour"],
  asafoetida: ["hing"],
  fenugreek: ["methi"],
  "mustard seeds": ["rai", "sarson", "black mustard seeds"],
  "curry leaves": ["kadi patta", "sweet neem leaves"],
  tomato: ["tomatoes"],
};

// Build normalized-phrase -> canonical-normalized-phrase lookup once.
const ALIAS_INDEX = new Map();
Object.keys(SYNONYMS).forEach((canonical) => {
  const canonNorm = normalize(canonical);
  ALIAS_INDEX.set(canonNorm, canonNorm);
  SYNONYMS[canonical].forEach((alias) => {
    ALIAS_INDEX.set(normalize(alias), canonNorm);
  });
});

// Canonicalize an ingredient/pantry name for equality matching. Tries the
// full normalized phrase, then progressively drops leading modifier words
// ("fresh", "frozen", "boneless", "green", …) so "frozen shrimp" and
// "green chili" resolve onto their head noun without a hardcoded stopword
// list — only a whole trailing phrase already in ALIAS_INDEX ever matches,
// so "chili powder" is never confused with "chili".
function canonicalize(name) {
  const norm = normalize(name);
  if (ALIAS_INDEX.has(norm)) return ALIAS_INDEX.get(norm);
  const words = norm.split(" ");
  for (let i = 1; i < words.length; i++) {
    const suffix = words.slice(i).join(" ");
    if (ALIAS_INDEX.has(suffix)) return ALIAS_INDEX.get(suffix);
  }
  return norm;
}

function namesMatch(a, b) {
  return canonicalize(a) === canonicalize(b);
}

// True if `text` (a recipe title/ingredient name/allergen tag) or its
// canonical form contains `term`. Substring match is normalised-string, not
// token-boundary — deliberately loose because this feeds a SAFETY filter
// (§6: allergens are a hard filter, never a ranking penalty) where a false
// negative (missed allergen) is worse than a false positive (over-excluded
// recipe).
function textMatchesTerm(text, term) {
  const nText = normalize(text);
  const nTerm = normalize(term);
  if (!nTerm) return false;
  if (nText.includes(nTerm) || nTerm.includes(nText)) return true;
  return canonicalize(text) === canonicalize(term);
}

function recipeMatchesAnyTerm(recipe, terms) {
  const list = (terms || []).filter(Boolean);
  if (!list.length) return false;
  return list.some((term) => {
    if (recipe.allergens.some((a) => textMatchesTerm(a, term))) return true;
    return recipe.ingredients.some((ing) => textMatchesTerm(ing.name, term));
  });
}

// ---------- date helpers (local YYYY-MM-DD, same convention as lib/goals.js) ----------

function todayYMD(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addDaysYMD(ymd, days) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return todayYMD(d);
}

// ---------- recipe data ----------
// Stable hand-written ids (rc_*). ~28 Indian (North + South), ~22 Thai,
// ~12 other, for a weeknight-realistic ~60-recipe library.

const RECIPES = [
  // ================= INDIAN — NORTH (15) =================
  {
    id: "rc_dal_tadka",
    title: "Dal Tadka",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 35,
    prep: [{ label: "Soak toor dal", leadHours: 2 }],
    ingredients: [
      { name: "toor dal", category: "protein", core: true, qtyHint: "1 cup" },
      { name: "turmeric", category: "spice", core: true, qtyHint: "1/2 tsp" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "cumin seeds", category: "spice", core: true, qtyHint: "1 tsp" },
      { name: "ghee", category: "dairy", core: false, qtyHint: "1 tbsp" },
      { name: "coriander leaves", category: "produce", core: false, qtyHint: "small handful" },
    ],
    steps: [
      "Rinse and pressure-cook toor dal with turmeric and water until soft.",
      "Whisk cooked dal smooth; add salt and simmer.",
      "Heat ghee, crackle cumin seeds, add chopped garlic and onion.",
      "Fry until golden, add tomato, cook until pulpy.",
      "Pour the tempering over the simmering dal.",
      "Simmer 5 minutes and garnish with coriander leaves.",
    ],
    proteinGPerPortion: 12,
    allergens: ["dairy"],
    tags: ["weeknight", "one-pot", "everyday"],
  },
  {
    id: "rc_rajma",
    title: "Rajma",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 50,
    prep: [{ label: "Soak kidney beans", leadHours: 8 }],
    ingredients: [
      { name: "kidney beans", category: "protein", core: true, qtyHint: "1.5 cups dried" },
      { name: "onion", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "garam masala", category: "spice", core: true, qtyHint: "1 tsp" },
      { name: "cumin seeds", category: "spice", core: false, qtyHint: "1 tsp" },
    ],
    steps: [
      "Drain soaked kidney beans and pressure-cook until soft, about 25 minutes.",
      "Heat oil, crackle cumin, sauté onion until golden.",
      "Add ginger-garlic paste, cook a minute.",
      "Add tomato and spices, cook until oil separates.",
      "Add cooked beans with their liquid, simmer 15 minutes, mashing a few beans.",
      "Finish with garam masala and serve with rice.",
    ],
    proteinGPerPortion: 14,
    allergens: [],
    tags: ["weeknight", "batch-cook", "everyday"],
  },
  {
    id: "rc_chole",
    title: "Chole",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 45,
    prep: [{ label: "Soak chickpeas", leadHours: 8 }],
    ingredients: [
      { name: "chickpea", category: "protein", core: true, qtyHint: "1.5 cups dried" },
      { name: "onion", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, pureed" },
      { name: "chole masala", category: "spice", core: true, qtyHint: "2 tbsp" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "tea bag", category: "pantry", core: false, qtyHint: "1, for colour" },
    ],
    steps: [
      "Pressure-cook soaked chickpeas with a tea bag until soft; discard tea bag.",
      "Sauté onion in oil until deep golden.",
      "Add ginger-garlic, tomato puree and chole masala, cook until thick.",
      "Add cooked chickpeas with some cooking liquid.",
      "Simmer 15 minutes, mashing a few chickpeas to thicken.",
      "Adjust salt and serve with rice or bhature.",
    ],
    proteinGPerPortion: 13,
    allergens: [],
    tags: ["weeknight", "batch-cook"],
  },
  {
    id: "rc_palak_paneer",
    title: "Palak Paneer",
    cuisine: "indian",
    region: "north-indian",
    slots: ["dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "spinach", category: "produce", core: true, qtyHint: "500g" },
      { name: "paneer", category: "dairy", core: true, qtyHint: "250g, cubed" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "cream", category: "dairy", core: false, qtyHint: "2 tbsp" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1/2 tsp" },
    ],
    steps: [
      "Blanch spinach 2 minutes in boiling water, then blend to a smooth puree.",
      "Sauté onion and garlic until soft, add tomato and cook down.",
      "Stir in the spinach puree and simmer 5 minutes.",
      "Add paneer cubes and garam masala, simmer 5 more minutes.",
      "Swirl in cream off the heat and serve with roti.",
    ],
    proteinGPerPortion: 16,
    allergens: ["dairy"],
    tags: ["weeknight", "veg"],
  },
  {
    id: "rc_butter_chicken",
    title: "Butter Chicken",
    cuisine: "indian",
    region: "north-indian",
    slots: ["dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 50,
    prep: [{ label: "Marinate chicken in yogurt and spices", leadHours: 4 }],
    ingredients: [
      { name: "chicken thighs", category: "protein", core: true, qtyHint: "600g, boneless" },
      { name: "curd", category: "dairy", core: true, qtyHint: "1/2 cup" },
      { name: "tomato", category: "produce", core: true, qtyHint: "4, pureed" },
      { name: "butter", category: "dairy", core: true, qtyHint: "3 tbsp" },
      { name: "cream", category: "dairy", core: false, qtyHint: "1/4 cup" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1 tsp" },
    ],
    steps: [
      "Marinate chicken in curd, ginger-garlic and spices for at least 4 hours.",
      "Sear marinated chicken pieces until charred at the edges; set aside.",
      "Melt butter, cook tomato puree with ginger-garlic until thick and dark.",
      "Blend the sauce smooth, return to the pan.",
      "Add seared chicken, simmer until cooked through.",
      "Stir in cream and a knob of butter, finish with garam masala.",
    ],
    proteinGPerPortion: 28,
    allergens: ["dairy"],
    tags: ["dinner-party", "restaurant-style"],
  },
  {
    id: "rc_jeera_rice",
    title: "Jeera Rice",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "basmati rice", category: "grain", core: true, qtyHint: "2 cups" },
      { name: "cumin seeds", category: "spice", core: true, qtyHint: "1.5 tsp" },
      { name: "bay leaf", category: "spice", core: false, qtyHint: "1" },
      { name: "oil", category: "pantry", core: false, qtyHint: "1 tbsp" },
    ],
    steps: [
      "Rinse basmati rice until water runs clear.",
      "Heat oil, crackle cumin seeds and bay leaf.",
      "Add rice, stir a minute to coat in the fat.",
      "Add water (1:1.75) and salt, bring to a boil.",
      "Cover, simmer 12 minutes, then rest off heat before fluffing.",
    ],
    proteinGPerPortion: 4,
    allergens: [],
    tags: ["side", "quick"],
  },
  {
    id: "rc_roti",
    title: "Roti",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "whole wheat flour", category: "grain", core: true, qtyHint: "2 cups" },
      { name: "water", category: "other", core: true, qtyHint: "as needed" },
      { name: "salt", category: "pantry", core: false, qtyHint: "pinch" },
      { name: "ghee", category: "dairy", core: false, qtyHint: "for brushing" },
    ],
    steps: [
      "Knead flour, salt and water into a soft dough; rest 15 minutes.",
      "Divide into balls and roll each into a thin round.",
      "Cook on a hot dry tawa until small bubbles appear, then flip.",
      "Puff directly over an open flame or press with a cloth.",
      "Brush lightly with ghee and serve hot.",
    ],
    proteinGPerPortion: 4,
    allergens: ["gluten"],
    tags: ["side", "bread", "everyday"],
  },
  {
    id: "rc_aloo_gobi",
    title: "Aloo Gobi",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "potato", category: "produce", core: true, qtyHint: "2, cubed" },
      { name: "cauliflower", category: "produce", core: true, qtyHint: "1 small head, florets" },
      { name: "turmeric", category: "spice", core: false, qtyHint: "1/2 tsp" },
      { name: "cumin seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "coriander leaves", category: "produce", core: false, qtyHint: "for garnish" },
    ],
    steps: [
      "Heat oil, crackle cumin seeds.",
      "Add potato and cauliflower, sprinkle turmeric and salt.",
      "Cover and cook on low heat, stirring occasionally, until tender.",
      "Uncover and cook a few minutes more to lightly brown.",
      "Garnish with coriander and serve with roti.",
    ],
    proteinGPerPortion: 5,
    allergens: [],
    tags: ["weeknight", "dry-curry", "everyday"],
  },
  {
    id: "rc_kadhi",
    title: "Kadhi",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "curd", category: "dairy", core: true, qtyHint: "2 cups, sour" },
      { name: "besan", category: "pantry", core: true, qtyHint: "1/4 cup" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
      { name: "turmeric", category: "spice", core: false, qtyHint: "1/2 tsp" },
    ],
    steps: [
      "Whisk curd, besan, turmeric and water into a lump-free batter.",
      "Bring to a gentle simmer, stirring often so it doesn't split.",
      "Simmer 20 minutes until thickened and no raw besan taste remains.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Pour the tempering over the kadhi and serve with rice.",
    ],
    proteinGPerPortion: 8,
    allergens: ["dairy"],
    tags: ["comfort-food", "everyday"],
  },
  {
    id: "rc_chicken_biryani",
    title: "Chicken Biryani",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 2,
    kidFriendly: true,
    timeMins: 75,
    prep: [{ label: "Marinate chicken in yogurt and spices", leadHours: 4 }],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "800g, bone-in" },
      { name: "basmati rice", category: "grain", core: true, qtyHint: "3 cups" },
      { name: "curd", category: "dairy", core: true, qtyHint: "1 cup" },
      { name: "onion", category: "produce", core: true, qtyHint: "3, fried crisp" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "5 cloves" },
      { name: "biryani masala", category: "spice", core: true, qtyHint: "2 tbsp" },
      { name: "saffron", category: "spice", core: false, qtyHint: "a pinch, in warm milk" },
      { name: "mint leaves", category: "produce", core: false, qtyHint: "handful" },
    ],
    steps: [
      "Marinate chicken in curd, ginger-garlic and biryani masala for 4 hours.",
      "Parboil basmati rice with whole spices until 70% cooked; drain.",
      "Cook the marinated chicken until nearly done in a wide pot.",
      "Layer parboiled rice over the chicken, top with fried onions, mint and saffron milk.",
      "Cover tightly and cook on very low heat 20 minutes (dum).",
      "Rest 10 minutes, then fold gently before serving.",
    ],
    proteinGPerPortion: 26,
    allergens: ["dairy"],
    tags: ["dinner-party", "one-pot", "weekend"],
  },
  {
    id: "rc_paneer_bhurji",
    title: "Paneer Bhurji",
    cuisine: "indian",
    region: "north-indian",
    slots: ["breakfast", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "paneer", category: "dairy", core: true, qtyHint: "250g, crumbled" },
      { name: "onion", category: "produce", core: true, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "1, chopped" },
      { name: "green chili", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "turmeric", category: "spice", core: false, qtyHint: "1/4 tsp" },
      { name: "coriander leaves", category: "produce", core: false, qtyHint: "for garnish" },
    ],
    steps: [
      "Heat oil, sauté onion and green chili until soft.",
      "Add tomato and turmeric, cook until pulpy.",
      "Crumble in paneer and toss to coat with the masala.",
      "Cook 3-4 minutes on medium heat, stirring gently.",
      "Garnish with coriander and serve with toast or paratha.",
    ],
    proteinGPerPortion: 18,
    allergens: ["dairy"],
    tags: ["quick", "breakfast", "high-protein"],
  },
  {
    id: "rc_baingan_bharta",
    title: "Baingan Bharta",
    cuisine: "indian",
    region: "north-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 2,
    kidFriendly: false,
    timeMins: 40,
    prep: [],
    ingredients: [
      { name: "eggplant", category: "produce", core: true, qtyHint: "1 large" },
      { name: "onion", category: "produce", core: true, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "green chili", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "coriander leaves", category: "produce", core: false, qtyHint: "for garnish" },
    ],
    steps: [
      "Char the whole eggplant directly over a flame or under a broiler until collapsed.",
      "Cool, peel, and mash the smoky flesh.",
      "Sauté onion, garlic and green chili until golden.",
      "Add tomato, cook until pulpy and oil separates.",
      "Fold in the mashed eggplant, cook 8 minutes.",
      "Garnish with coriander and serve with roti.",
    ],
    proteinGPerPortion: 4,
    allergens: [],
    tags: ["smoky", "weeknight"],
  },
  {
    id: "rc_matar_paneer",
    title: "Matar Paneer",
    cuisine: "indian",
    region: "north-indian",
    slots: ["dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "paneer", category: "dairy", core: true, qtyHint: "250g, cubed" },
      { name: "green peas", category: "frozen", core: true, qtyHint: "1 cup" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, pureed" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1/2 tsp" },
    ],
    steps: [
      "Sauté onion and ginger until golden.",
      "Add tomato puree and spices, cook until thick.",
      "Add peas and a splash of water, simmer 5 minutes.",
      "Add paneer cubes, simmer 5 minutes more.",
      "Finish with garam masala and serve with rice or roti.",
    ],
    proteinGPerPortion: 15,
    allergens: ["dairy"],
    tags: ["weeknight", "veg"],
  },
  {
    id: "rc_tandoori_chicken",
    title: "Tandoori Chicken",
    cuisine: "indian",
    region: "north-indian",
    slots: ["dinner"],
    veg: false,
    spice: 2,
    kidFriendly: true,
    timeMins: 45,
    prep: [{ label: "Marinate chicken in yogurt and spices", leadHours: 4 }],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "800g, bone-in, skinless" },
      { name: "curd", category: "dairy", core: true, qtyHint: "1 cup" },
      { name: "tandoori masala", category: "spice", core: true, qtyHint: "2 tbsp" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "lemon", category: "produce", core: false, qtyHint: "1, juiced" },
    ],
    steps: [
      "Score the chicken pieces and rub with lemon juice and salt.",
      "Mix curd, tandoori masala and ginger-garlic; coat the chicken and marinate 4 hours.",
      "Preheat oven or grill to very hot.",
      "Roast or grill chicken, basting once, until charred and cooked through.",
      "Rest 5 minutes and serve with lemon wedges and onion rings.",
    ],
    proteinGPerPortion: 30,
    allergens: ["dairy"],
    tags: ["grill", "weekend"],
  },
  {
    id: "rc_egg_curry",
    title: "Egg Curry",
    cuisine: "indian",
    region: "north-indian",
    slots: ["dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "eggs", category: "protein", core: true, qtyHint: "6, hard-boiled" },
      { name: "onion", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, pureed" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1/2 tsp" },
    ],
    steps: [
      "Boil, peel and lightly score the eggs; shallow-fry until blistered.",
      "Sauté onion until golden, add ginger-garlic paste.",
      "Add tomato puree and spices, cook until oil separates.",
      "Add water to a curry consistency, simmer 10 minutes.",
      "Slide in the eggs, simmer 5 minutes and serve with rice.",
    ],
    proteinGPerPortion: 14,
    allergens: ["egg"],
    tags: ["weeknight", "budget"],
  },

  // ================= INDIAN — WEST (2) =================
  {
    id: "rc_moong_usal",
    title: "Moong Usal",
    cuisine: "indian",
    region: "west-indian",
    slots: ["breakfast", "dinner"],
    veg: true,
    spice: 2,
    kidFriendly: false,
    timeMins: 25,
    prep: [{ label: "Sprout moong beans", leadHours: 36 }],
    ingredients: [
      { name: "mung bean", category: "protein", core: true, qtyHint: "1.5 cups, sprouted" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "goda masala", category: "spice", core: true, qtyHint: "1 tbsp" },
      { name: "coconut", category: "produce", core: false, qtyHint: "2 tbsp, grated" },
      { name: "coriander leaves", category: "produce", core: false, qtyHint: "for garnish" },
    ],
    steps: [
      "Soak whole moong overnight, drain, then leave wrapped in a damp cloth until sprouted (about a day and a half).",
      "Heat oil, sauté onion until golden.",
      "Add tomato and goda masala, cook until fragrant.",
      "Add sprouted moong and water, cover and simmer until just tender.",
      "Stir in grated coconut and garnish with coriander.",
    ],
    proteinGPerPortion: 12,
    allergens: [],
    tags: ["sprouted", "high-protein", "breakfast"],
  },
  {
    id: "rc_poha",
    title: "Poha",
    cuisine: "indian",
    region: "west-indian",
    slots: ["breakfast"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "poha", category: "grain", core: true, qtyHint: "2 cups, flattened rice" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "potato", category: "produce", core: false, qtyHint: "1, diced small" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
      { name: "peanut", category: "pantry", core: false, qtyHint: "2 tbsp, roasted" },
      { name: "lemon", category: "produce", core: false, qtyHint: "1, juiced" },
    ],
    steps: [
      "Rinse poha in a colander until softened; drain well.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Add diced potato and onion, cook until soft.",
      "Add turmeric and rinsed poha, toss gently to combine.",
      "Cook 3 minutes covered, stir in peanuts and lemon juice.",
    ],
    proteinGPerPortion: 5,
    allergens: ["peanut"],
    tags: ["breakfast", "quick", "everyday"],
  },

  // ================= INDIAN — SOUTH (11) =================
  {
    id: "rc_idli",
    title: "Idli",
    cuisine: "indian",
    region: "south-indian",
    slots: ["breakfast"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [{ label: "Ferment idli batter", leadHours: 12 }],
    ingredients: [
      { name: "idli rice", category: "grain", core: true, qtyHint: "2 cups" },
      { name: "urad dal", category: "protein", core: true, qtyHint: "1/2 cup" },
      { name: "fenugreek", category: "spice", core: false, qtyHint: "1/2 tsp" },
      { name: "salt", category: "pantry", core: false, qtyHint: "to taste" },
    ],
    steps: [
      "Soak rice and urad dal (with fenugreek) separately for 4-6 hours.",
      "Grind each to a smooth batter, then combine.",
      "Add salt and leave to ferment in a warm place overnight.",
      "Pour fermented batter into greased idli moulds.",
      "Steam 10-12 minutes until a skewer comes out clean.",
      "Serve hot with sambar and coconut chutney.",
    ],
    proteinGPerPortion: 6,
    allergens: [],
    tags: ["breakfast", "steamed", "fermented"],
  },
  {
    id: "rc_dosa",
    title: "Dosa",
    cuisine: "indian",
    region: "south-indian",
    slots: ["breakfast", "dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [{ label: "Ferment dosa batter", leadHours: 12 }],
    ingredients: [
      { name: "dosa rice", category: "grain", core: true, qtyHint: "3 cups" },
      { name: "urad dal", category: "protein", core: true, qtyHint: "1 cup" },
      { name: "fenugreek", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "oil", category: "pantry", core: false, qtyHint: "for the pan" },
    ],
    steps: [
      "Soak rice and urad dal (with fenugreek) separately for 4-6 hours.",
      "Grind to a smooth, pourable batter and combine.",
      "Salt and ferment overnight in a warm place.",
      "Heat a flat pan, pour a ladle of batter and spread thin in circles.",
      "Drizzle oil around the edges and cook until golden and crisp.",
      "Fold and serve with sambar and chutney.",
    ],
    proteinGPerPortion: 6,
    allergens: [],
    tags: ["breakfast", "fermented", "everyday"],
  },
  {
    id: "rc_sambar",
    title: "Sambar",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 40,
    prep: [{ label: "Soak toor dal", leadHours: 2 }],
    ingredients: [
      { name: "toor dal", category: "protein", core: true, qtyHint: "1 cup" },
      { name: "mixed vegetables", category: "produce", core: true, qtyHint: "2 cups, drumstick/carrot/pumpkin" },
      { name: "tamarind", category: "pantry", core: true, qtyHint: "small lemon-size ball" },
      { name: "sambar powder", category: "spice", core: true, qtyHint: "2 tbsp" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
    ],
    steps: [
      "Pressure-cook toor dal until soft; mash smooth.",
      "Simmer vegetables in tamarind water until tender.",
      "Add cooked dal and sambar powder, simmer 10 minutes.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Pour the tempering over the sambar and serve with rice or idli.",
    ],
    proteinGPerPortion: 10,
    allergens: [],
    tags: ["everyday", "one-pot"],
  },
  {
    id: "rc_rasam",
    title: "Rasam",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 2,
    kidFriendly: false,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "toor dal", category: "protein", core: false, qtyHint: "2 tbsp, cooked" },
      { name: "tomato", category: "produce", core: true, qtyHint: "2, chopped" },
      { name: "tamarind", category: "pantry", core: true, qtyHint: "small ball" },
      { name: "rasam powder", category: "spice", core: true, qtyHint: "1.5 tbsp" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
    ],
    steps: [
      "Simmer tomato in tamarind water until soft.",
      "Add rasam powder and a little cooked dal, simmer 10 minutes.",
      "Top up with water to a thin, soupy consistency.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Pour the tempering over the rasam and serve with rice.",
    ],
    proteinGPerPortion: 5,
    allergens: [],
    tags: ["tangy", "comfort-food"],
  },
  {
    id: "rc_upma",
    title: "Upma",
    cuisine: "indian",
    region: "south-indian",
    slots: ["breakfast"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "semolina", category: "grain", core: true, qtyHint: "1 cup, rava" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
      { name: "green chili", category: "produce", core: false, qtyHint: "1, chopped" },
    ],
    steps: [
      "Dry-roast semolina until lightly fragrant; set aside.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Sauté onion and green chili until soft.",
      "Add water and salt, bring to a boil.",
      "Stir in roasted semolina, cook covered until fluffy.",
    ],
    proteinGPerPortion: 6,
    allergens: ["gluten"],
    tags: ["breakfast", "quick"],
  },
  {
    id: "rc_lemon_rice",
    title: "Lemon Rice",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "basmati rice", category: "grain", core: true, qtyHint: "2 cups, cooked" },
      { name: "lemon", category: "produce", core: true, qtyHint: "2, juiced" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "peanut", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
      { name: "turmeric", category: "spice", core: false, qtyHint: "1/2 tsp" },
    ],
    steps: [
      "Heat oil, crackle mustard seeds, peanuts and curry leaves.",
      "Add turmeric and a pinch of asafoetida.",
      "Add cooked, cooled rice and toss to coat evenly.",
      "Remove from heat and stir in lemon juice and salt.",
      "Serve at room temperature.",
    ],
    proteinGPerPortion: 5,
    allergens: ["peanut"],
    tags: ["lunchbox", "quick", "use-up-rice"],
  },
  {
    id: "rc_curd_rice",
    title: "Curd Rice",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 15,
    prep: [],
    ingredients: [
      { name: "basmati rice", category: "grain", core: true, qtyHint: "1.5 cups, cooked" },
      { name: "curd", category: "dairy", core: true, qtyHint: "1.5 cups" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "6-8" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1/2 inch, grated" },
    ],
    steps: [
      "Mash cooked rice while still warm with a little milk.",
      "Stir in curd and salt once the rice has cooled.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Pour the tempering over the curd rice and mix in grated ginger.",
      "Chill briefly and serve.",
    ],
    proteinGPerPortion: 7,
    allergens: ["dairy"],
    tags: ["cooling", "lunchbox", "use-up-rice"],
  },
  {
    id: "rc_avial",
    title: "Avial",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "mixed vegetables", category: "produce", core: true, qtyHint: "3 cups, drumstick/yam/beans/carrot" },
      { name: "coconut", category: "produce", core: true, qtyHint: "1 cup, grated" },
      { name: "curd", category: "dairy", core: false, qtyHint: "2 tbsp" },
      { name: "cumin seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "coconut oil", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10" },
    ],
    steps: [
      "Boil the mixed vegetables in a little water until just tender.",
      "Grind coconut and cumin seeds to a coarse paste.",
      "Stir the coconut paste into the vegetables and simmer briefly.",
      "Fold in curd off the heat so it doesn't split.",
      "Finish with a drizzle of coconut oil and curry leaves.",
    ],
    proteinGPerPortion: 6,
    allergens: ["dairy"],
    tags: ["kerala", "mixed-veg"],
  },
  {
    id: "rc_coconut_chutney",
    title: "Coconut Chutney",
    cuisine: "indian",
    region: "south-indian",
    slots: ["breakfast"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 15,
    prep: [],
    ingredients: [
      { name: "coconut", category: "produce", core: true, qtyHint: "1.5 cups, grated" },
      { name: "roasted gram dal", category: "protein", core: false, qtyHint: "2 tbsp" },
      { name: "green chili", category: "produce", core: false, qtyHint: "1" },
      { name: "mustard seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "6-8" },
    ],
    steps: [
      "Blend coconut, roasted gram dal, green chili and a little water to a smooth paste.",
      "Season with salt.",
      "Heat oil, crackle mustard seeds and curry leaves.",
      "Pour the tempering over the chutney and serve with idli or dosa.",
    ],
    proteinGPerPortion: 3,
    allergens: [],
    tags: ["side", "breakfast", "quick"],
  },
  {
    id: "rc_medu_vada",
    title: "Medu Vada",
    cuisine: "indian",
    region: "south-indian",
    slots: ["breakfast"],
    veg: true,
    spice: 1,
    kidFriendly: true,
    timeMins: 35,
    prep: [{ label: "Soak urad dal", leadHours: 4 }],
    ingredients: [
      { name: "urad dal", category: "protein", core: true, qtyHint: "2 cups" },
      { name: "green chili", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "curry leaves", category: "spice", core: false, qtyHint: "8-10, chopped" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1/2 inch, chopped" },
      { name: "oil", category: "pantry", core: true, qtyHint: "for deep-frying" },
    ],
    steps: [
      "Drain soaked urad dal and grind to a thick, fluffy batter with minimal water.",
      "Fold in chopped chili, curry leaves and ginger; season.",
      "Wet hands, shape batter into rings directly into hot oil.",
      "Fry until golden and crisp, turning once.",
      "Drain and serve hot with sambar and chutney.",
    ],
    proteinGPerPortion: 8,
    allergens: [],
    tags: ["breakfast", "fried", "weekend"],
  },
  {
    id: "rc_bisi_bele_bath",
    title: "Bisi Bele Bath",
    cuisine: "indian",
    region: "south-indian",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 2,
    kidFriendly: true,
    timeMins: 45,
    prep: [{ label: "Soak toor dal", leadHours: 2 }],
    ingredients: [
      { name: "basmati rice", category: "grain", core: true, qtyHint: "1 cup" },
      { name: "toor dal", category: "protein", core: true, qtyHint: "1/2 cup" },
      { name: "mixed vegetables", category: "produce", core: true, qtyHint: "2 cups, carrot/beans/peas" },
      { name: "bisi bele bath powder", category: "spice", core: true, qtyHint: "3 tbsp" },
      { name: "tamarind", category: "pantry", core: true, qtyHint: "small ball" },
      { name: "ghee", category: "dairy", core: false, qtyHint: "1 tbsp" },
    ],
    steps: [
      "Pressure-cook rice, toor dal and vegetables together until soft.",
      "Simmer tamarind water with bisi bele bath powder.",
      "Mash the rice-dal mixture and stir into the tamarind mixture.",
      "Simmer until thick and porridge-like, adjusting water as needed.",
      "Finish with a spoon of ghee before serving.",
    ],
    proteinGPerPortion: 11,
    allergens: ["dairy"],
    tags: ["one-pot", "karnataka", "kid-staple"],
  },

  // ================= THAI (22) =================
  {
    id: "rc_pad_krapao",
    title: "Pad Krapao Gai",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 3,
    kidFriendly: false,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "400g, minced" },
      { name: "holy basil", category: "produce", core: true, qtyHint: "1 cup, leaves" },
      { name: "bird's eye chili", category: "produce", core: true, qtyHint: "5-8, crushed" },
      { name: "garlic", category: "produce", core: true, qtyHint: "5 cloves" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "oyster sauce", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "egg", category: "protein", core: false, qtyHint: "1, fried, to top" },
      { name: "jasmine rice", category: "grain", core: true, qtyHint: "for serving" },
    ],
    steps: [
      "Pound garlic and chilies together in a mortar.",
      "Stir-fry the pounded paste in hot oil until fragrant.",
      "Add minced chicken, stir-fry until nearly cooked through.",
      "Season with fish sauce, oyster sauce and a little sugar.",
      "Toss in holy basil leaves off the heat until wilted.",
      "Serve over jasmine rice topped with a crispy fried egg.",
    ],
    proteinGPerPortion: 26,
    allergens: ["fish", "shellfish", "egg"],
    tags: ["weeknight", "spicy", "street-food"],
  },
  {
    id: "rc_green_curry",
    title: "Green Curry (Gaeng Keow Wan)",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "500g, sliced" },
      { name: "green curry paste", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "2 cans" },
      { name: "eggplant", category: "produce", core: true, qtyHint: "1 cup, Thai eggplant" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "kaffir lime leaves", category: "produce", core: false, qtyHint: "4, torn" },
      { name: "thai basil", category: "produce", core: false, qtyHint: "handful" },
    ],
    steps: [
      "Simmer the thick part of the coconut milk until the oil separates.",
      "Fry green curry paste in the split coconut cream until fragrant.",
      "Add chicken, stir to coat and cook a few minutes.",
      "Pour in remaining coconut milk and bring to a simmer.",
      "Add eggplant and kaffir lime leaves, cook until tender.",
      "Season with fish sauce and a little palm sugar, finish with Thai basil.",
    ],
    proteinGPerPortion: 22,
    allergens: ["fish", "shellfish"],
    tags: ["curry", "weeknight"],
  },
  {
    id: "rc_red_curry",
    title: "Red Curry (Gaeng Phed)",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "500g, sliced" },
      { name: "red curry paste", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "2 cans" },
      { name: "bamboo shoots", category: "pantry", core: false, qtyHint: "1 cup" },
      { name: "bell pepper", category: "produce", core: false, qtyHint: "1, sliced" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "thai basil", category: "produce", core: false, qtyHint: "handful" },
    ],
    steps: [
      "Simmer the thick part of the coconut milk until the oil separates.",
      "Fry red curry paste in the split coconut cream until fragrant.",
      "Add chicken, stir to coat and cook a few minutes.",
      "Pour in remaining coconut milk, add bamboo shoots and bell pepper.",
      "Simmer until chicken is cooked through.",
      "Season with fish sauce and palm sugar, finish with Thai basil.",
    ],
    proteinGPerPortion: 22,
    allergens: ["fish", "shellfish"],
    tags: ["curry", "weeknight"],
  },
  {
    id: "rc_massaman_curry",
    title: "Massaman Curry",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 60,
    prep: [],
    ingredients: [
      { name: "beef", category: "protein", core: true, qtyHint: "600g, stewing cubes" },
      { name: "massaman curry paste", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "2 cans" },
      { name: "potato", category: "produce", core: true, qtyHint: "2, cubed" },
      { name: "peanut", category: "pantry", core: true, qtyHint: "1/2 cup, roasted" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, cut in wedges" },
      { name: "tamarind", category: "pantry", core: false, qtyHint: "2 tbsp, pulp" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Fry massaman curry paste in a little coconut cream until fragrant.",
      "Add beef and sear on all sides.",
      "Pour in coconut milk, cover and simmer until the beef is tender, about 45 minutes.",
      "Add potato, onion and peanuts, simmer until vegetables are soft.",
      "Season with fish sauce, tamarind and palm sugar.",
      "Serve with jasmine rice.",
    ],
    proteinGPerPortion: 24,
    allergens: ["peanut", "fish", "shellfish"],
    tags: ["curry", "mild", "slow-cook", "weekend"],
  },
  {
    id: "rc_tom_yum_goong",
    title: "Tom Yum Goong",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 3,
    kidFriendly: false,
    timeMins: 25,
    prep: [{ label: "Thaw frozen shrimp", leadHours: 8 }],
    ingredients: [
      { name: "shrimp", category: "frozen", core: true, qtyHint: "400g" },
      { name: "lemongrass", category: "produce", core: true, qtyHint: "2 stalks, bruised" },
      { name: "galangal", category: "produce", core: true, qtyHint: "4-5 slices" },
      { name: "kaffir lime leaves", category: "produce", core: true, qtyHint: "4, torn" },
      { name: "mushroom", category: "produce", core: false, qtyHint: "1 cup, straw mushrooms" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "lime", category: "produce", core: true, qtyHint: "2, juiced" },
      { name: "bird's eye chili", category: "produce", core: false, qtyHint: "5, crushed" },
    ],
    steps: [
      "Bring stock to a boil with lemongrass, galangal and kaffir lime leaves.",
      "Add mushrooms and simmer a few minutes.",
      "Add shrimp and cook until just pink.",
      "Season with fish sauce and crushed chilies.",
      "Remove from heat and stir in lime juice.",
      "Serve immediately, hot and sour.",
    ],
    proteinGPerPortion: 18,
    allergens: ["shellfish", "fish"],
    tags: ["soup", "spicy", "hot-and-sour"],
  },
  {
    id: "rc_tom_kha_gai",
    title: "Tom Kha Gai",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "400g, sliced" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "2 cans" },
      { name: "galangal", category: "produce", core: true, qtyHint: "4-5 slices" },
      { name: "lemongrass", category: "produce", core: true, qtyHint: "2 stalks, bruised" },
      { name: "mushroom", category: "produce", core: false, qtyHint: "1 cup" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "lime", category: "produce", core: false, qtyHint: "1, juiced" },
    ],
    steps: [
      "Simmer coconut milk with galangal and lemongrass until fragrant.",
      "Add chicken and mushrooms, simmer until chicken is cooked through.",
      "Season with fish sauce and a little sugar.",
      "Remove from heat and stir in lime juice.",
      "Serve hot with jasmine rice.",
    ],
    proteinGPerPortion: 20,
    allergens: ["fish"],
    tags: ["soup", "mild", "comfort-food"],
  },
  {
    id: "rc_pad_thai",
    title: "Pad Thai",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [], // noodle soak is part of active cooking (timeMins), not an advance lead time
    ingredients: [
      { name: "rice noodles", category: "grain", core: true, qtyHint: "250g, flat" },
      { name: "shrimp", category: "protein", core: true, qtyHint: "300g" },
      { name: "egg", category: "protein", core: true, qtyHint: "2" },
      { name: "tofu", category: "protein", core: false, qtyHint: "100g, firm, diced" },
      { name: "tamarind", category: "pantry", core: true, qtyHint: "2 tbsp, pulp" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "peanut", category: "pantry", core: true, qtyHint: "1/4 cup, crushed" },
      { name: "bean sprouts", category: "produce", core: false, qtyHint: "1 cup" },
      { name: "dried shrimp", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "2, chopped" },
    ],
    steps: [
      "Soak rice noodles in warm water until pliable; drain.",
      "Mix tamarind pulp, fish sauce, palm sugar into a pad Thai sauce.",
      "Stir-fry shrimp and tofu in hot oil until nearly cooked.",
      "Push aside, scramble egg in the same pan.",
      "Add noodles and sauce, toss until noodles soften and absorb the sauce.",
      "Fold in bean sprouts, dried shrimp and half the peanuts.",
      "Plate and top with remaining crushed peanuts and spring onion.",
    ],
    proteinGPerPortion: 20,
    allergens: ["peanut", "egg", "fish", "shellfish"],
    tags: ["noodles", "street-food", "weeknight"],
  },
  {
    id: "rc_som_tam",
    title: "Som Tam",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch"],
    veg: false,
    spice: 3,
    kidFriendly: false,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "green papaya", category: "produce", core: true, qtyHint: "2 cups, shredded" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, wedged" },
      { name: "green beans", category: "produce", core: false, qtyHint: "handful" },
      { name: "peanut", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "dried shrimp", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "lime", category: "produce", core: true, qtyHint: "1, juiced" },
      { name: "bird's eye chili", category: "produce", core: true, qtyHint: "4-6" },
      { name: "palm sugar", category: "pantry", core: false, qtyHint: "1 tbsp" },
    ],
    steps: [
      "Pound garlic and chilies in a mortar to a rough paste.",
      "Add green beans and tomato wedges, bruise lightly.",
      "Add shredded papaya, peanuts and dried shrimp.",
      "Season with fish sauce, lime juice and palm sugar.",
      "Pound and toss together until just combined; do not mash to a paste.",
      "Serve immediately with sticky rice.",
    ],
    proteinGPerPortion: 6,
    allergens: ["fish", "shellfish", "peanut"],
    tags: ["salad", "spicy", "raw"],
  },
  {
    id: "rc_khao_pad",
    title: "Khao Pad",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "jasmine rice", category: "grain", core: true, qtyHint: "3 cups, cooked and cooled" },
      { name: "chicken", category: "protein", core: true, qtyHint: "300g, diced" },
      { name: "egg", category: "protein", core: true, qtyHint: "2" },
      { name: "onion", category: "produce", core: false, qtyHint: "1/2, chopped" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, wedged" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "2, chopped" },
    ],
    steps: [
      "Stir-fry chicken in hot oil until cooked through; push aside.",
      "Scramble egg in the same pan.",
      "Add cold cooked rice, breaking up clumps.",
      "Season with fish sauce and a little soy sauce, tossing to coat evenly.",
      "Fold in tomato and spring onion just before serving.",
      "Serve with lime wedges and cucumber.",
    ],
    proteinGPerPortion: 18,
    allergens: ["egg", "fish", "soy"],
    tags: ["fried-rice", "quick", "use-up-rice"],
  },
  {
    id: "rc_larb",
    title: "Larb Gai",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "400g, minced" },
      { name: "roasted rice powder", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "lime", category: "produce", core: true, qtyHint: "2, juiced" },
      { name: "shallot", category: "produce", core: false, qtyHint: "3, thinly sliced" },
      { name: "mint leaves", category: "produce", core: false, qtyHint: "handful" },
      { name: "bird's eye chili", category: "produce", core: false, qtyHint: "3, crushed" },
    ],
    steps: [
      "Cook minced chicken in a dry pan with a splash of water, breaking it up finely.",
      "Once cooked and most liquid has evaporated, remove from heat.",
      "Toss with fish sauce, lime juice and crushed chili while still warm.",
      "Fold in shallot, roasted rice powder and mint.",
      "Serve with sticky rice and lettuce leaves.",
    ],
    proteinGPerPortion: 24,
    allergens: ["fish"],
    tags: ["salad", "spicy", "isaan"],
  },
  {
    id: "rc_pad_see_ew",
    title: "Pad See Ew",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "rice noodles", category: "grain", core: true, qtyHint: "300g, wide, fresh" },
      { name: "chicken", category: "protein", core: true, qtyHint: "300g, sliced" },
      { name: "egg", category: "protein", core: true, qtyHint: "2" },
      { name: "chinese broccoli", category: "produce", core: true, qtyHint: "2 cups" },
      { name: "dark soy sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "fish sauce", category: "pantry", core: false, qtyHint: "1 tbsp" },
    ],
    steps: [
      "Stir-fry chicken in hot oil until nearly cooked.",
      "Push aside, crack in egg and scramble.",
      "Add wide rice noodles and Chinese broccoli.",
      "Toss with dark soy sauce and fish sauce over high heat.",
      "Stir-fry until noodles have a little char and broccoli is just tender.",
    ],
    proteinGPerPortion: 20,
    allergens: ["soy", "gluten", "egg", "fish"],
    tags: ["noodles", "weeknight"],
  },
  {
    id: "rc_gaeng_jued",
    title: "Gaeng Jued (Clear Tofu Soup)",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "tofu", category: "protein", core: true, qtyHint: "1 block, soft, cubed" },
      { name: "pork", category: "protein", core: true, qtyHint: "200g, minced" },
      { name: "napa cabbage", category: "produce", core: true, qtyHint: "2 cups" },
      { name: "soy sauce", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "garlic", category: "produce", core: false, qtyHint: "2 cloves" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "2, chopped" },
      { name: "white pepper", category: "spice", core: false, qtyHint: "pinch" },
    ],
    steps: [
      "Bring stock to a gentle boil with garlic.",
      "Drop in small balls of minced pork.",
      "Add napa cabbage and tofu cubes, simmer until pork is cooked.",
      "Season with soy sauce and white pepper.",
      "Garnish with spring onion and serve hot.",
    ],
    proteinGPerPortion: 16,
    allergens: ["soy"],
    tags: ["soup", "mild", "everyday"],
  },
  {
    id: "rc_khao_man_gai",
    title: "Khao Man Gai",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 50,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "1 whole, or thighs" },
      { name: "jasmine rice", category: "grain", core: true, qtyHint: "2 cups" },
      { name: "ginger", category: "produce", core: true, qtyHint: "1 knob" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "soybean paste", category: "pantry", core: false, qtyHint: "2 tbsp, for dipping sauce" },
      { name: "cucumber", category: "produce", core: false, qtyHint: "1, sliced" },
    ],
    steps: [
      "Poach the whole chicken gently in stock with ginger until just cooked.",
      "Rest the chicken in the broth, then remove and slice.",
      "Cook rice in the reserved chicken broth and chicken fat.",
      "Blend soybean paste, garlic, ginger, vinegar and chili for the dipping sauce.",
      "Plate rice with sliced chicken and cucumber, sauce on the side.",
      "Serve with a small bowl of the poaching broth.",
    ],
    proteinGPerPortion: 28,
    allergens: ["soy"],
    tags: ["one-pot", "mild", "kid-staple"],
  },
  {
    id: "rc_moo_ping",
    title: "Moo Ping",
    cuisine: "thai",
    region: "thai",
    slots: ["breakfast", "lunch"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [{ label: "Marinate pork skewers", leadHours: 4 }],
    ingredients: [
      { name: "pork", category: "protein", core: true, qtyHint: "500g, shoulder, sliced" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "1/4 cup" },
      { name: "palm sugar", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "soy sauce", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "fish sauce", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "coriander root", category: "produce", core: false, qtyHint: "2, pounded" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
    ],
    steps: [
      "Pound garlic and coriander root to a paste.",
      "Mix with coconut milk, palm sugar, soy sauce and fish sauce.",
      "Marinate sliced pork in the mixture for at least 4 hours.",
      "Thread pork onto skewers.",
      "Grill over charcoal or a hot pan, turning and basting, until charred and cooked through.",
      "Serve with sticky rice and a dipping sauce.",
    ],
    proteinGPerPortion: 22,
    allergens: ["soy", "fish"],
    tags: ["grill", "street-food", "weekend"],
  },
  {
    id: "rc_pad_pak_boong",
    title: "Pad Pak Boong Fai Daeng",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 10,
    prep: [],
    ingredients: [
      { name: "morning glory", category: "produce", core: true, qtyHint: "1 large bunch" },
      { name: "garlic", category: "produce", core: true, qtyHint: "5 cloves" },
      { name: "bird's eye chili", category: "produce", core: true, qtyHint: "4-6" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "1 tbsp" },
      { name: "oyster sauce", category: "pantry", core: true, qtyHint: "1 tbsp" },
      { name: "soybean paste", category: "pantry", core: false, qtyHint: "1 tsp" },
    ],
    steps: [
      "Pound garlic and chilies to a rough paste.",
      "Heat oil until very hot, add the paste and stir-fry briefly.",
      "Add morning glory in one go, stems first.",
      "Toss over the highest heat with fish sauce, oyster sauce and soybean paste.",
      "Stir-fry no more than 90 seconds so it stays crisp; serve immediately.",
    ],
    proteinGPerPortion: 5,
    allergens: ["fish", "shellfish"],
    tags: ["stir-fry", "quick", "vegetable"],
  },
  {
    id: "rc_panang_curry",
    title: "Panang Curry",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "500g, sliced" },
      { name: "panang curry paste", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "2 cans" },
      { name: "peanut", category: "pantry", core: true, qtyHint: "1/4 cup, ground" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "kaffir lime leaves", category: "produce", core: false, qtyHint: "4, finely sliced" },
    ],
    steps: [
      "Simmer the thick part of the coconut milk until the oil separates.",
      "Fry panang curry paste in the split coconut cream until fragrant.",
      "Add chicken and ground peanuts, stir to coat.",
      "Pour in remaining coconut milk, simmer until thick and chicken is cooked.",
      "Season with fish sauce and palm sugar.",
      "Top with finely sliced kaffir lime leaves before serving.",
    ],
    proteinGPerPortion: 24,
    allergens: ["peanut", "fish", "shellfish"],
    tags: ["curry", "rich"],
  },
  {
    id: "rc_mango_sticky_rice",
    title: "Mango Sticky Rice",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 40,
    prep: [{ label: "Soak sticky rice", leadHours: 4 }],
    ingredients: [
      { name: "sticky rice", category: "grain", core: true, qtyHint: "2 cups, glutinous" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "1 can" },
      { name: "mango", category: "produce", core: true, qtyHint: "2, ripe, sliced" },
      { name: "palm sugar", category: "pantry", core: true, qtyHint: "1/3 cup" },
      { name: "salt", category: "pantry", core: false, qtyHint: "pinch" },
    ],
    steps: [
      "Soak sticky rice in water at least 4 hours; drain.",
      "Steam the rice over simmering water for 20-25 minutes until translucent.",
      "Warm coconut milk with palm sugar and salt until dissolved; reserve some for topping.",
      "Fold most of the sweet coconut milk into the hot steamed rice; let it absorb.",
      "Plate the rice with sliced mango.",
      "Drizzle the reserved coconut sauce over the top before serving.",
    ],
    proteinGPerPortion: 4,
    allergens: [],
    tags: ["dessert", "sweet", "weekend"],
  },
  {
    id: "rc_satay",
    title: "Chicken Satay",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 30,
    prep: [{ label: "Marinate chicken skewers", leadHours: 4 }],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "500g, sliced thin" },
      { name: "coconut milk", category: "pantry", core: true, qtyHint: "1/2 cup" },
      { name: "yellow curry powder", category: "spice", core: false, qtyHint: "1 tbsp" },
      { name: "peanut", category: "pantry", core: true, qtyHint: "1 cup, for the sauce" },
      { name: "soy sauce", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "cucumber", category: "produce", core: false, qtyHint: "1, for relish" },
    ],
    steps: [
      "Marinate sliced chicken in coconut milk and curry powder for at least 4 hours.",
      "Thread chicken onto skewers.",
      "Grill over hot coals or a griddle until charred and cooked through.",
      "Blend roasted peanuts with coconut milk, curry paste and palm sugar for the satay sauce; simmer until thick.",
      "Serve skewers with peanut sauce and a cucumber relish.",
    ],
    proteinGPerPortion: 24,
    allergens: ["peanut", "soy"],
    tags: ["grill", "street-food", "kid-friendly"],
  },
  {
    id: "rc_khai_jiao",
    title: "Thai Omelette (Khai Jiao)",
    cuisine: "thai",
    region: "thai",
    slots: ["breakfast", "lunch"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 10,
    prep: [],
    ingredients: [
      { name: "eggs", category: "protein", core: true, qtyHint: "4" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "1 tbsp" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "oil", category: "pantry", core: true, qtyHint: "for shallow-frying" },
    ],
    steps: [
      "Beat eggs vigorously with fish sauce and spring onion.",
      "Heat plenty of oil in a wok until very hot.",
      "Pour in the egg mixture all at once; it should sizzle and puff immediately.",
      "Fry until the edges are crisp and golden, then flip briefly.",
      "Drain and serve over jasmine rice with sriracha.",
    ],
    proteinGPerPortion: 12,
    allergens: ["egg", "fish"],
    tags: ["quick", "budget", "kid-staple"],
  },
  {
    id: "rc_suki",
    title: "Thai Suki",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 1,
    kidFriendly: true,
    timeMins: 25,
    prep: [{ label: "Thaw frozen seafood mix", leadHours: 8 }],
    ingredients: [
      { name: "glass noodles", category: "grain", core: true, qtyHint: "150g" },
      { name: "seafood mix", category: "frozen", core: true, qtyHint: "300g, shrimp/squid" },
      { name: "napa cabbage", category: "produce", core: false, qtyHint: "2 cups" },
      { name: "egg", category: "protein", core: false, qtyHint: "1, for the dip" },
      { name: "soy sauce", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves, for the dip" },
    ],
    steps: [
      "Soak glass noodles in warm water until soft; drain.",
      "Bring a light stock to a boil.",
      "Add seafood mix and napa cabbage, cook until seafood is just done.",
      "Add glass noodles and warm through.",
      "Mix a dipping sauce of soy sauce, garlic, chili and lime, with a raw egg stirred in if liked.",
      "Serve the hot pot with the dipping sauce on the side.",
    ],
    proteinGPerPortion: 18,
    allergens: ["shellfish", "soy", "egg"],
    tags: ["hot-pot", "one-pot"],
  },
  {
    id: "rc_kua_kling",
    title: "Kua Kling",
    cuisine: "thai",
    region: "thai",
    slots: ["dinner"],
    veg: false,
    spice: 3,
    kidFriendly: false,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "pork", category: "protein", core: true, qtyHint: "500g, minced" },
      { name: "kua kling curry paste", category: "pantry", core: true, qtyHint: "4 tbsp" },
      { name: "kaffir lime leaves", category: "produce", core: true, qtyHint: "6, finely sliced" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "1 tbsp" },
      { name: "shrimp paste", category: "pantry", core: false, qtyHint: "1 tsp" },
      { name: "peppercorns", category: "spice", core: false, qtyHint: "1 tsp, fresh green" },
    ],
    steps: [
      "Fry the curry paste in a dry, hot pan until very fragrant, almost dry.",
      "Add minced pork, breaking it up as it cooks.",
      "Cook, stirring constantly, until the liquid evaporates completely.",
      "Season with fish sauce and a touch of shrimp paste.",
      "Stir in kaffir lime leaves and fresh peppercorns off the heat.",
      "Serve dry, with sticky rice, for confirmed spice-lovers only.",
    ],
    proteinGPerPortion: 26,
    allergens: ["fish", "shellfish"],
    tags: ["spicy", "southern-thai", "dry-curry"],
  },
  {
    id: "rc_boat_noodles",
    title: "Boat Noodles (Kuay Teow Reua)",
    cuisine: "thai",
    region: "thai",
    slots: ["lunch"],
    veg: false,
    spice: 2,
    kidFriendly: false,
    timeMins: 45,
    prep: [],
    ingredients: [
      { name: "beef", category: "protein", core: true, qtyHint: "400g, thinly sliced" },
      { name: "rice noodles", category: "grain", core: true, qtyHint: "300g" },
      { name: "beef stock", category: "pantry", core: true, qtyHint: "1.5 litres" },
      { name: "dark soy sauce", category: "pantry", core: true, qtyHint: "3 tbsp" },
      { name: "fish sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
      { name: "morning glory", category: "produce", core: false, qtyHint: "1 cup" },
      { name: "bean sprouts", category: "produce", core: false, qtyHint: "1 cup" },
    ],
    steps: [
      "Simmer beef stock with warm spices (cinnamon, star anise) until fragrant.",
      "Season the broth with dark soy sauce and fish sauce until deep and dark.",
      "Blanch rice noodles, morning glory and bean sprouts; divide into bowls.",
      "Poach thin beef slices directly in the simmering broth.",
      "Ladle hot broth and beef over the noodles.",
      "Top with chili flakes and fresh herbs to taste.",
    ],
    proteinGPerPortion: 20,
    allergens: ["soy", "gluten", "fish"],
    tags: ["noodles", "soup", "spicy"],
  },

  // ================= OTHER — WEEKNIGHT VARIETY (12) =================
  {
    id: "rc_pasta_tomato",
    title: "Spaghetti with Tomato Sauce",
    cuisine: "other",
    region: "italian",
    slots: ["dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "spaghetti", category: "grain", core: true, qtyHint: "400g" },
      { name: "tomato", category: "pantry", core: true, qtyHint: "2 tins, crushed" },
      { name: "garlic", category: "produce", core: false, qtyHint: "3 cloves" },
      { name: "basil", category: "produce", core: false, qtyHint: "handful" },
      { name: "parmesan", category: "dairy", core: false, qtyHint: "to serve" },
      { name: "olive oil", category: "pantry", core: false, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Cook spaghetti in salted boiling water until al dente.",
      "Sauté garlic in olive oil until fragrant, not browned.",
      "Add crushed tomato and simmer 15 minutes.",
      "Season with salt, pepper and torn basil.",
      "Toss drained spaghetti through the sauce.",
      "Serve with grated parmesan.",
    ],
    proteinGPerPortion: 10,
    allergens: ["gluten", "dairy"],
    tags: ["weeknight", "quick", "pantry-staple"],
  },
  {
    id: "rc_roast_chicken",
    title: "Roast Chicken",
    cuisine: "other",
    region: "other",
    slots: ["dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 90,
    prep: [],
    ingredients: [
      { name: "chicken", category: "protein", core: true, qtyHint: "1 whole" },
      { name: "lemon", category: "produce", core: false, qtyHint: "1, halved" },
      { name: "garlic", category: "produce", core: false, qtyHint: "1 head, halved" },
      { name: "butter", category: "dairy", core: false, qtyHint: "2 tbsp" },
      { name: "potato", category: "produce", core: false, qtyHint: "4, for roasting" },
    ],
    steps: [
      "Pat the chicken dry and season generously inside and out.",
      "Stuff the cavity with lemon and garlic.",
      "Rub the skin with butter and arrange potatoes around it.",
      "Roast at 200C, basting once, until juices run clear (about 75-90 minutes).",
      "Rest 10 minutes before carving.",
    ],
    proteinGPerPortion: 32,
    allergens: ["dairy"],
    tags: ["weekend", "roast", "sunday-dinner"],
  },
  {
    id: "rc_egg_fried_rice",
    title: "Egg Fried Rice",
    cuisine: "other",
    region: "chinese",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 15,
    prep: [],
    ingredients: [
      { name: "jasmine rice", category: "grain", core: true, qtyHint: "3 cups, cooked and cooled" },
      { name: "egg", category: "protein", core: true, qtyHint: "3" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "2, chopped" },
      { name: "green peas", category: "frozen", core: false, qtyHint: "1/2 cup" },
      { name: "soy sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Scramble eggs in a hot wok; remove and set aside.",
      "Add cold cooked rice, breaking up clumps, and stir-fry a few minutes.",
      "Add peas and cook until warmed through.",
      "Return egg to the wok and toss to combine.",
      "Season with soy sauce and garnish with spring onion.",
    ],
    proteinGPerPortion: 14,
    allergens: ["egg", "soy", "gluten"],
    tags: ["quick", "use-up-rice", "budget"],
  },
  {
    id: "rc_grilled_cheese",
    title: "Grilled Cheese Sandwich",
    cuisine: "other",
    region: "american",
    slots: ["lunch"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 10,
    prep: [],
    ingredients: [
      { name: "bread", category: "grain", core: true, qtyHint: "4 slices" },
      { name: "cheddar cheese", category: "dairy", core: true, qtyHint: "4 slices" },
      { name: "butter", category: "dairy", core: true, qtyHint: "2 tbsp, softened" },
    ],
    steps: [
      "Butter one side of each bread slice.",
      "Layer cheese between the unbuttered sides of two sandwiches.",
      "Cook butter-side down in a hot pan until golden.",
      "Flip and cook until the second side is golden and cheese has melted.",
      "Slice and serve hot.",
    ],
    proteinGPerPortion: 14,
    allergens: ["dairy", "gluten"],
    tags: ["quick", "lunchbox", "kid-favorite"],
  },
  {
    id: "rc_chicken_wrap",
    title: "Chicken Wrap",
    cuisine: "other",
    region: "american",
    slots: ["lunch"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "chicken breast", category: "protein", core: true, qtyHint: "2, sliced" },
      { name: "tortilla", category: "grain", core: true, qtyHint: "4, large" },
      { name: "lettuce", category: "produce", core: false, qtyHint: "1 cup, shredded" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, sliced" },
      { name: "cheddar cheese", category: "dairy", core: false, qtyHint: "1/2 cup, grated" },
      { name: "mayonnaise", category: "pantry", core: false, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Season and pan-fry chicken breast until cooked through; slice.",
      "Warm the tortillas briefly in a dry pan.",
      "Spread mayonnaise over each tortilla.",
      "Layer chicken, lettuce, tomato and cheese down the centre.",
      "Fold in the sides and roll tightly.",
      "Slice in half and serve.",
    ],
    proteinGPerPortion: 24,
    allergens: ["gluten", "dairy", "egg"],
    tags: ["lunchbox", "quick"],
  },
  {
    id: "rc_veg_soup",
    title: "Vegetable Soup",
    cuisine: "other",
    region: "other",
    slots: ["lunch", "dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 35,
    prep: [],
    ingredients: [
      { name: "carrot", category: "produce", core: true, qtyHint: "2, diced" },
      { name: "potato", category: "produce", core: true, qtyHint: "2, diced" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "celery", category: "produce", core: false, qtyHint: "2 stalks, diced" },
      { name: "vegetable stock", category: "pantry", core: true, qtyHint: "1.5 litres" },
    ],
    steps: [
      "Sauté onion and celery in a little oil until soft.",
      "Add carrot and potato, stir a minute.",
      "Pour in stock and bring to a boil.",
      "Simmer until vegetables are tender, about 20 minutes.",
      "Season to taste and serve with bread.",
    ],
    proteinGPerPortion: 4,
    allergens: [],
    tags: ["comfort-food", "batch-cook", "freezer-friendly"],
  },
  {
    id: "rc_scrambled_eggs_toast",
    title: "Scrambled Eggs on Toast",
    cuisine: "other",
    region: "american",
    slots: ["breakfast"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 10,
    prep: [],
    ingredients: [
      { name: "eggs", category: "protein", core: true, qtyHint: "4" },
      { name: "butter", category: "dairy", core: true, qtyHint: "1 tbsp" },
      { name: "milk", category: "dairy", core: false, qtyHint: "splash" },
      { name: "bread", category: "grain", core: true, qtyHint: "4 slices, toasted" },
    ],
    steps: [
      "Whisk eggs with a splash of milk and a pinch of salt.",
      "Melt butter in a nonstick pan over low heat.",
      "Pour in eggs and stir gently and continuously.",
      "Remove from heat while still slightly wet; they'll finish cooking off the heat.",
      "Pile onto hot buttered toast and serve.",
    ],
    proteinGPerPortion: 16,
    allergens: ["egg", "dairy", "gluten"],
    tags: ["breakfast", "quick"],
  },
  {
    id: "rc_mac_and_cheese",
    title: "Mac and Cheese",
    cuisine: "other",
    region: "american",
    slots: ["dinner"],
    veg: true,
    spice: 0,
    kidFriendly: true,
    timeMins: 30,
    prep: [],
    ingredients: [
      { name: "macaroni", category: "grain", core: true, qtyHint: "400g" },
      { name: "cheddar cheese", category: "dairy", core: true, qtyHint: "2 cups, grated" },
      { name: "milk", category: "dairy", core: true, qtyHint: "2 cups" },
      { name: "butter", category: "dairy", core: false, qtyHint: "2 tbsp" },
      { name: "flour", category: "grain", core: false, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Cook macaroni in salted boiling water until al dente; drain.",
      "Melt butter, whisk in flour and cook a minute to make a roux.",
      "Gradually whisk in milk, cooking until thickened.",
      "Stir in most of the cheese until melted and smooth.",
      "Fold in the macaroni and top with remaining cheese.",
      "Bake or grill until bubbling and golden on top.",
    ],
    proteinGPerPortion: 16,
    allergens: ["dairy", "gluten"],
    tags: ["kid-favorite", "comfort-food", "weeknight"],
  },
  {
    id: "rc_bolognese",
    title: "Spaghetti Bolognese",
    cuisine: "other",
    region: "italian",
    slots: ["dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 50,
    prep: [],
    ingredients: [
      { name: "beef", category: "protein", core: true, qtyHint: "500g, minced" },
      { name: "spaghetti", category: "grain", core: true, qtyHint: "400g" },
      { name: "tomato", category: "pantry", core: true, qtyHint: "2 tins, crushed" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "carrot", category: "produce", core: false, qtyHint: "1, diced" },
      { name: "garlic", category: "produce", core: false, qtyHint: "2 cloves" },
      { name: "parmesan", category: "dairy", core: false, qtyHint: "to serve" },
    ],
    steps: [
      "Sauté onion, carrot and garlic until soft.",
      "Add minced beef, browning well.",
      "Add crushed tomato, season and simmer 30 minutes, stirring occasionally.",
      "Cook spaghetti in salted boiling water until al dente.",
      "Toss spaghetti with the bolognese sauce.",
      "Serve with grated parmesan.",
    ],
    proteinGPerPortion: 22,
    allergens: ["gluten", "dairy"],
    tags: ["batch-cook", "freezer-friendly", "weeknight"],
  },
  {
    id: "rc_club_sandwich",
    title: "Club Sandwich",
    cuisine: "other",
    region: "american",
    slots: ["lunch"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 20,
    prep: [],
    ingredients: [
      { name: "bread", category: "grain", core: true, qtyHint: "6 slices, toasted" },
      { name: "chicken breast", category: "protein", core: true, qtyHint: "1, cooked, sliced" },
      { name: "bacon", category: "protein", core: false, qtyHint: "4 strips, cooked" },
      { name: "lettuce", category: "produce", core: false, qtyHint: "leaves" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, sliced" },
      { name: "mayonnaise", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "cheddar cheese", category: "dairy", core: false, qtyHint: "2 slices" },
    ],
    steps: [
      "Toast the bread slices.",
      "Spread mayonnaise on each slice.",
      "Layer chicken, bacon, lettuce, tomato and cheese between the slices.",
      "Stack into a triple-decker and secure with cocktail sticks.",
      "Cut into quarters and serve.",
    ],
    proteinGPerPortion: 26,
    allergens: ["gluten", "egg", "dairy"],
    tags: ["lunchbox", "no-cook-mostly"],
  },
  {
    id: "rc_shrimp_fried_rice",
    title: "Shrimp Fried Rice",
    cuisine: "other",
    region: "chinese",
    slots: ["lunch", "dinner"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 20,
    prep: [{ label: "Thaw frozen shrimp", leadHours: 8 }],
    ingredients: [
      { name: "shrimp", category: "frozen", core: true, qtyHint: "300g" },
      { name: "jasmine rice", category: "grain", core: true, qtyHint: "3 cups, cooked and cooled" },
      { name: "egg", category: "protein", core: true, qtyHint: "2" },
      { name: "green peas", category: "frozen", core: false, qtyHint: "1/2 cup" },
      { name: "spring onion", category: "produce", core: false, qtyHint: "2, chopped" },
      { name: "soy sauce", category: "pantry", core: true, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Stir-fry shrimp in a hot wok until just pink; remove.",
      "Scramble egg in the same wok; remove.",
      "Add cold cooked rice, breaking up clumps, and stir-fry a few minutes.",
      "Add peas, then return shrimp and egg to the wok.",
      "Season with soy sauce and toss to combine.",
      "Garnish with spring onion.",
    ],
    proteinGPerPortion: 20,
    allergens: ["shellfish", "egg", "soy", "gluten"],
    tags: ["quick", "use-up-rice"],
  },
  {
    id: "rc_pancakes",
    title: "Pancakes",
    cuisine: "other",
    region: "american",
    slots: ["breakfast"],
    veg: false,
    spice: 0,
    kidFriendly: true,
    timeMins: 25,
    prep: [],
    ingredients: [
      { name: "flour", category: "grain", core: true, qtyHint: "2 cups" },
      { name: "milk", category: "dairy", core: true, qtyHint: "1.5 cups" },
      { name: "eggs", category: "protein", core: true, qtyHint: "2" },
      { name: "butter", category: "dairy", core: false, qtyHint: "2 tbsp, melted" },
      { name: "baking powder", category: "pantry", core: true, qtyHint: "2 tsp" },
      { name: "sugar", category: "pantry", core: false, qtyHint: "2 tbsp" },
    ],
    steps: [
      "Whisk flour, baking powder, sugar and a pinch of salt.",
      "In a separate bowl, whisk milk, eggs and melted butter.",
      "Combine wet and dry ingredients, mixing until just smooth.",
      "Ladle batter onto a hot greased griddle.",
      "Cook until bubbles form on top, then flip and cook the other side.",
      "Serve warm with syrup and fruit.",
    ],
    proteinGPerPortion: 10,
    allergens: ["egg", "dairy", "gluten"],
    tags: ["breakfast", "weekend", "kid-favorite"],
  },

  /* ---------- the household's own rotation ----------
     Meals this family already cooks, added so the planner suggests what they
     actually eat rather than only what the library imagines. Built to the
     house rule of clearing 20g protein and 20g fibre in a portion, lactose-
     free by default (the yoghurt/protein powder here are the lactose-free
     kinds this kitchen stocks), and portion-scaled per eater like everything
     else — see docs/MEALS-PLAN.md §2. No per-person medical targets live in
     this data; a bigger eater simply gets a bigger portion factor. */
  {
    id: "rc_egg_white_scramble",
    title: "Egg-White Scramble with Spinach & Tomato",
    cuisine: "other", region: "household",
    slots: ["breakfast"], veg: false, spice: 0, kidFriendly: true, timeMins: 10,
    prep: [],
    ingredients: [
      { name: "eggs", category: "protein", core: true, qtyHint: "1 whole + 3 whites" },
      { name: "egg whites", category: "protein", core: true, qtyHint: "3" },
      { name: "spinach", category: "produce", core: true, qtyHint: "2 big handfuls" },
      { name: "tomato", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "olive oil", category: "pantry", core: false, qtyHint: "1 tsp" },
      { name: "black pepper", category: "spice", core: false, qtyHint: "to taste" },
    ],
    steps: [
      "Warm the oil in a non-stick pan over medium-low heat.",
      "Wilt the spinach and tomato for a minute.",
      "Pour in the beaten whole egg and whites; stir slowly until just set.",
      "Season and serve — scale whites up for a bigger portion, not oil.",
    ],
    proteinGPerPortion: 24,
    allergens: ["egg"],
    tags: ["high-protein", "weekday", "quick", "lactose-free"],
  },
  {
    id: "rc_chia_yogurt_bowl",
    title: "Chia & Vanilla Yoghurt Bowl",
    cuisine: "other", region: "household",
    slots: ["breakfast", "snack"], veg: true, spice: 0, kidFriendly: true, timeMins: 5,
    prep: [{ label: "Soak chia in the yoghurt", leadHours: 8 }],
    ingredients: [
      { name: "greek yogurt", category: "dairy", core: true, qtyHint: "1/2–3/4 cup (lactose-free)" },
      { name: "chia seeds", category: "pantry", core: true, qtyHint: "1 tbsp" },
      { name: "berries", category: "produce", core: false, qtyHint: "1/2 cup" },
      { name: "rolled oats", category: "grain", core: false, qtyHint: "1/2–1 cup cooked, for a bigger portion" },
      { name: "almonds", category: "pantry", core: false, qtyHint: "a small handful" },
    ],
    steps: [
      "Stir the chia into the yoghurt and leave overnight to thicken.",
      "Top with berries and almonds in the morning.",
      "Fold in cooked oats for anyone who needs the extra carbohydrate.",
    ],
    proteinGPerPortion: 20,
    allergens: ["dairy", "treenut"],
    tags: ["high-protein", "high-fibre", "make-ahead", "no-cook"],
  },
  {
    id: "rc_grilled_chicken_brown_rice",
    title: "Grilled Chicken with Brown Rice & Greens",
    cuisine: "other", region: "household",
    slots: ["lunch", "dinner"], veg: false, spice: 1, kidFriendly: true, timeMins: 30,
    prep: [{ label: "Marinate the chicken in lime, garlic and pepper", leadHours: 2 }],
    ingredients: [
      { name: "chicken breast", category: "protein", core: true, qtyHint: "100–180g per person" },
      { name: "brown rice", category: "grain", core: true, qtyHint: "1/2–1.5 cups cooked per person" },
      { name: "broccoli", category: "produce", core: true, qtyHint: "1–1.5 cups" },
      { name: "green beans", category: "produce", core: false, qtyHint: "1 cup" },
      { name: "olive oil", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "lime", category: "produce", core: false, qtyHint: "1/2" },
      { name: "garlic", category: "produce", core: false, qtyHint: "2 cloves" },
    ],
    steps: [
      "Marinate the chicken in lime, crushed garlic, pepper and a little oil.",
      "Grill or pan-sear 5–6 minutes a side until cooked through; rest, then slice.",
      "Steam the broccoli and beans until just tender.",
      "Plate over brown rice — bigger eaters get more rice and a drizzle of oil, not more oil alone.",
    ],
    proteinGPerPortion: 38,
    allergens: [],
    tags: ["high-protein", "high-fibre", "meal-prep", "lactose-free"],
  },
  {
    id: "rc_chicken_curry_dal_bhindi",
    title: "Light Chicken Curry with Dal & Bhindi",
    cuisine: "indian", region: "north-indian",
    slots: ["dinner"], veg: false, spice: 2, kidFriendly: true, timeMins: 45,
    prep: [{ label: "Soak the dal", leadHours: 2 }],
    ingredients: [
      { name: "chicken breast", category: "protein", core: true, qtyHint: "80–150g per person" },
      { name: "toor dal", category: "protein", core: true, qtyHint: "1 cup dry" },
      { name: "okra", category: "produce", core: true, qtyHint: "300g, sliced" },
      { name: "tomato", category: "produce", core: true, qtyHint: "3, chopped" },
      { name: "onion", category: "produce", core: false, qtyHint: "1, chopped" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "turmeric", category: "spice", core: true, qtyHint: "1/2 tsp" },
      { name: "cumin seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "olive oil", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "lime", category: "produce", core: false, qtyHint: "1, wedges" },
    ],
    steps: [
      "Boil the soaked dal with turmeric and salt until soft; keep it loose.",
      "Cook onion, ginger and garlic in oil, add tomato and spices, and reduce to a gravy.",
      "Add the chicken and simmer gently until just cooked — no cream needed.",
      "Separately fry the okra hard and dry so it doesn't go slimy; salt at the end.",
      "Serve all three together with lime wedges over the dal (the lime helps iron absorption).",
    ],
    proteinGPerPortion: 34,
    allergens: [],
    tags: ["high-protein", "high-fibre", "weeknight", "lactose-free"],
  },
  {
    id: "rc_protein_shake",
    title: "Protein Shake, Three Ways",
    cuisine: "other", region: "household",
    slots: ["snack"], veg: true, spice: 0, kidFriendly: true, timeMins: 3,
    prep: [],
    ingredients: [
      { name: "protein powder", category: "protein", core: true, qtyHint: "1/2–1.5 scoops by portion" },
      { name: "almond milk", category: "pantry", core: false, qtyHint: "250ml" },
      { name: "banana", category: "produce", core: false, qtyHint: "1, for a post-sport shake" },
      { name: "berries", category: "produce", core: false, qtyHint: "1/2 cup, for a lighter one" },
      { name: "peanut butter", category: "pantry", core: false, qtyHint: "2 tbsp, to make it calorie-dense" },
    ],
    steps: [
      "Blend the powder with almond milk or water.",
      "After sport, add a banana for the carbohydrate and potassium.",
      "To make it a heavier, weight-gain shake, add peanut butter.",
      "To keep it light, use berries instead and skip the nut butter.",
    ],
    proteinGPerPortion: 26,
    allergens: ["peanut", "treenut"],
    tags: ["high-protein", "quick", "post-workout", "lactose-free"],
  },
  {
    id: "rc_oats_almond_bowl",
    title: "Fortified Oats with Almonds & Fruit",
    cuisine: "other", region: "household",
    slots: ["breakfast"], veg: true, spice: 0, kidFriendly: true, timeMins: 10,
    prep: [],
    ingredients: [
      { name: "rolled oats", category: "grain", core: true, qtyHint: "1/2–1 cup dry by portion" },
      { name: "almond milk", category: "pantry", core: true, qtyHint: "300ml" },
      { name: "almonds", category: "pantry", core: false, qtyHint: "a handful, chopped" },
      { name: "chia seeds", category: "pantry", core: false, qtyHint: "1 tbsp" },
      { name: "banana", category: "produce", core: false, qtyHint: "1, sliced" },
      { name: "protein powder", category: "protein", core: false, qtyHint: "1/2 scoop stirred in off the heat" },
    ],
    steps: [
      "Simmer the oats in almond milk until creamy.",
      "Take off the heat before stirring in any protein powder so it doesn't seize.",
      "Top with almonds, chia and banana.",
      "Scale the oats — not the toppings — for a bigger pre-sport breakfast.",
    ],
    proteinGPerPortion: 20,
    allergens: ["treenut"],
    tags: ["high-fibre", "pre-sport", "quick", "lactose-free"],
  },
  {
    id: "rc_tofu_palak",
    title: "Palak Tofu (lactose-free palak paneer)",
    cuisine: "indian", region: "north-indian",
    slots: ["lunch", "dinner"], veg: true, spice: 1, kidFriendly: true, timeMins: 30,
    prep: [],
    ingredients: [
      { name: "firm tofu", category: "protein", core: true, qtyHint: "300g, cubed" },
      { name: "spinach", category: "produce", core: true, qtyHint: "500g" },
      { name: "onion", category: "produce", core: false, qtyHint: "1" },
      { name: "garlic", category: "produce", core: false, qtyHint: "4 cloves" },
      { name: "ginger", category: "produce", core: false, qtyHint: "1 inch" },
      { name: "green chilli", category: "produce", core: false, qtyHint: "1" },
      { name: "cumin seeds", category: "spice", core: false, qtyHint: "1 tsp" },
      { name: "garam masala", category: "spice", core: false, qtyHint: "1/2 tsp" },
      { name: "olive oil", category: "pantry", core: false, qtyHint: "2 tbsp" },
      { name: "cashew paste", category: "pantry", core: false, qtyHint: "2 tbsp, for the creaminess" },
    ],
    steps: [
      "Blanch the spinach for a minute, then blend to a coarse purée.",
      "Pan-fry the tofu cubes until golden and set aside.",
      "Cook cumin, onion, ginger, garlic and chilli in oil until soft.",
      "Add the spinach purée and garam masala; simmer 5 minutes.",
      "Stir in cashew paste for body, fold the tofu back in, and finish with a squeeze of lime.",
    ],
    proteinGPerPortion: 22,
    allergens: ["soy", "treenut"],
    tags: ["high-protein", "high-fibre", "lactose-free", "weeknight"],
  },
];

// ---------- exported helpers ----------

/* ============================================================
   HOUSEHOLD DIETS, SWAPS, FIBRE
   A household diet is NOT a filter that hides food — hiding "dairy" would
   delete half the Indian library from a lactose-free kitchen, which is the
   opposite of useful. Instead each diet declares the allergen it rules out
   plus the swaps that make a dish work anyway (paneer → firm tofu, ghee →
   oil). A recipe is only excluded when a CORE ingredient has no swap.
============================================================ */

const DIETS = {
  "lactose-free": {
    label: "Lactose-free",
    excludes: ["dairy"],
    swaps: [
      { from: "paneer", to: "firm tofu" },
      { from: "ghee", to: "olive oil" },
      { from: "butter", to: "olive oil" },
      { from: "curd", to: "coconut or almond yoghurt" },
      { from: "yogurt", to: "coconut or almond yoghurt" },
      { from: "milk", to: "almond milk" },
      { from: "cream", to: "cashew cream" },
      { from: "khoya", to: "cashew paste" },
    ],
  },
  vegetarian: { label: "Vegetarian", excludes: ["fish", "shellfish"], swaps: [{ from: "fish sauce", to: "light soy + a pinch of salt" }, { from: "shrimp paste", to: "fermented bean paste" }], vegOnly: true },
  eggless: { label: "Eggless", excludes: ["egg"], swaps: [{ from: "egg", to: "silken tofu or flax egg" }] },
  "gluten-free": { label: "Gluten-free", excludes: ["gluten"], swaps: [{ from: "roti", to: "rice or millet roti" }, { from: "wheat flour", to: "rice flour" }, { from: "soy sauce", to: "tamari" }] },
  "nut-free": { label: "Nut-free", excludes: ["peanut", "treenut"], swaps: [{ from: "peanut", to: "toasted sunflower seed" }, { from: "cashew", to: "sunflower seed" }, { from: "almond", to: "pumpkin seed" }] },
};

// Rough fibre grams per portion, estimated from ingredients rather than
// hand-tagged on 62 recipes — an estimate that stays correct when a recipe is
// edited beats a frozen number that silently rots. Display-only, like protein.
const FIBRE_G = [
  [/\b(dal|lentil|masoor|toor|moong|urad|chana|chickpea|rajma|kidney bean|black bean|bean)\b/, 6],
  [/\b(brown rice|quinoa|oats|millet|barley|whole wheat|bulgur)\b/, 3],
  [/\b(spinach|okra|bhindi|cabbage|broccoli|cauliflower|gobi|beans|peas|carrot|pumpkin|aubergine|brinjal|eggplant|gourd|greens|methi)\b/, 2],
  [/\b(sweet potato|potato|corn|banana|berry|berries|apple|mango|papaya)\b/, 2],
  [/\b(tomato|onion|pepper|capsicum|mushroom|cucumber|sprout)\b/, 1],
  [/\b(chia|flax|almond|peanut|cashew|walnut|sesame|pumpkin seed|coconut)\b/, 1],
];
function estimateFiberG(recipe) {
  let g = 0;
  for (const ing of recipe.ingredients || []) {
    const n = normalize(ing.name);
    for (const [re, val] of FIBRE_G) {
      if (re.test(n)) { g += ing.core ? val : val / 2; break; }
    }
  }
  return Math.round(Math.min(g, 30));
}

// Swaps a household's diets require for this recipe, e.g. [{from:"paneer",
// to:"firm tofu"}]. Empty when the dish already fits.
function swapsFor(recipe, diets) {
  const out = [];
  for (const d of diets || []) {
    const def = DIETS[d];
    if (!def) continue;
    if (!(def.excludes || []).some((a) => (recipe.allergens || []).includes(a))) continue;
    for (const sw of def.swaps || []) {
      if ((recipe.ingredients || []).some((i) => normalize(i.name).includes(normalize(sw.from)))) {
        if (!out.some((o) => o.from === sw.from)) out.push(sw);
      }
    }
  }
  return out;
}

// A recipe is diet-INCOMPATIBLE only when an excluded allergen rides on a core
// ingredient that no swap covers (a fish curry can't be made vegetarian; a
// palak paneer can).
function fitsDiets(recipe, diets) {
  for (const d of diets || []) {
    const def = DIETS[d];
    if (!def) continue;
    if (def.vegOnly && !recipe.veg) {
      const swappable = (recipe.ingredients || []).filter((i) => i.core)
        .every((i) => !/\b(chicken|beef|pork|fish|prawn|shrimp|mutton|lamb|squid|crab)\b/.test(normalize(i.name)));
      if (!swappable) return false;
    }
    const hit = (def.excludes || []).some((a) => (recipe.allergens || []).includes(a));
    if (!hit) continue;
    const coreOffenders = (recipe.ingredients || []).filter((i) => i.core && (def.excludes || []).some((a) => allergenInIngredient(a, i.name)));
    const covered = coreOffenders.every((i) => (def.swaps || []).some((sw) => normalize(i.name).includes(normalize(sw.from))));
    if (!covered) return false;
  }
  return true;
}

// Which ingredient names carry which allergen — deliberately conservative and
// explicit, since this feeds a safety filter.
const ALLERGEN_IN_NAME = {
  dairy: /\b(paneer|ghee|butter|milk|cream|curd|yogurt|yoghurt|khoya|cheese|malai)\b/,
  egg: /\begg\b/,
  peanut: /\b(peanut|groundnut)\b/,
  treenut: /\b(almond|cashew|walnut|pistachio|hazelnut)\b/,
  sesame: /\b(sesame|tahini|til)\b/,
  soy: /\b(soy|soya|tofu|tamari|edamame)\b/,
  gluten: /\b(wheat|roti|naan|paratha|bread|noodle|pasta|maida|semolina|suji|barley)\b/,
  fish: /\b(fish|anchovy|fish sauce)\b/,
  shellfish: /\b(prawn|shrimp|crab|squid|shrimp paste)\b/,
};
function allergenInIngredient(allergen, name) {
  const re = ALLERGEN_IN_NAME[allergen];
  return re ? re.test(normalize(name)) : false;
}

// The staples a high-protein, high-fibre, Indian, lactose-free kitchen runs
// on — used to seed an empty pantry so the feature is useful on day one
// instead of after an hour of typing.
const STAPLES = [
  { name: "Toor dal", category: "protein" }, { name: "Moong dal", category: "protein" },
  { name: "Masoor dal", category: "protein" }, { name: "Chana (chickpeas)", category: "protein" },
  { name: "Rajma", category: "protein" }, { name: "Chicken breast", category: "protein" },
  { name: "Eggs", category: "protein" }, { name: "Firm tofu", category: "protein" },
  { name: "White fish", category: "protein" }, { name: "Minced beef", category: "protein" },
  { name: "Brown rice", category: "grain" }, { name: "Quinoa", category: "grain" },
  { name: "Rolled oats", category: "grain" }, { name: "Whole wheat flour", category: "grain" },
  { name: "Basmati rice", category: "grain" }, { name: "Sweet potato", category: "produce" },
  { name: "Spinach", category: "produce" }, { name: "Okra (bhindi)", category: "produce" },
  { name: "Tomato", category: "produce" }, { name: "Bell pepper", category: "produce" },
  { name: "Onion", category: "produce" }, { name: "Ginger", category: "produce" },
  { name: "Garlic", category: "produce" }, { name: "Green chilli", category: "produce" },
  { name: "Coriander", category: "produce" }, { name: "Lime", category: "produce" },
  { name: "Berries", category: "produce" }, { name: "Banana", category: "produce" },
  { name: "Almonds", category: "pantry" }, { name: "Walnuts", category: "pantry" },
  { name: "Pumpkin seeds", category: "pantry" }, { name: "Chia seeds", category: "pantry" },
  { name: "Flaxseed", category: "pantry" }, { name: "Olive oil", category: "pantry" },
  { name: "Coconut milk", category: "pantry" }, { name: "Peanut butter", category: "pantry" },
  { name: "Turmeric", category: "spice" }, { name: "Cumin seeds", category: "spice" },
  { name: "Mustard seeds", category: "spice" }, { name: "Garam masala", category: "spice" },
  { name: "Red chilli powder", category: "spice" }, { name: "Coriander powder", category: "spice" },
  { name: "Curry leaves", category: "spice" }, { name: "Fish sauce", category: "pantry" },
  { name: "Soy sauce", category: "pantry" }, { name: "Thai curry paste", category: "pantry" },
];

// Shared dietary gate for search() and suggest(): diets + per-meal protein and
// fibre floors (a household chasing "20g protein and 20g fibre a meal" sets
// minProteinG/minFiberG once and stops re-reading labels).
function passesDietary(r, { diets, minProteinG, minFiberG } = {}) {
  if (diets && diets.length && !fitsDiets(r, diets)) return false;
  if (Number.isFinite(minProteinG) && (r.proteinGPerPortion || 0) < minProteinG) return false;
  if (Number.isFinite(minFiberG) && (r.fiberGPerPortion || 0) < minFiberG) return false;
  return true;
}

// Every recipe carries its fibre estimate — computed once at load so callers
// can rank/filter on it exactly like the hand-written protein figure.
for (const r of RECIPES) r.fiberGPerPortion = estimateFiberG(r);

function all() {
  return RECIPES.slice();
}

function byId(id) {
  return RECIPES.find((r) => r.id === id) || null;
}

function search({ cuisine, veg, slot, kidFriendly, maxTimeMins, query, diets, minProteinG, minFiberG } = {}) {
  return RECIPES.filter((r) => {
    if (!passesDietary(r, { diets, minProteinG, minFiberG })) return false;
    if (cuisine && r.cuisine !== cuisine) return false;
    if (veg === true && !r.veg) return false;
    if (slot && !r.slots.includes(slot)) return false;
    if (kidFriendly === true && !r.kidFriendly) return false;
    if (Number.isFinite(maxTimeMins) && r.timeMins > maxTimeMins) return false;
    if (query) {
      const q = normalize(query);
      if (!q) return true;
      const haystack = normalize(
        [r.title, r.cuisine, r.region, ...r.tags, ...r.ingredients.map((i) => i.name)].join(" ")
      );
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// {have, missing, coreMissing, ratio} — an ingredient "have"s when SOME
// pantry item (level !== "out") canonicalizes to the same name.
function coverage(recipe, pantryItems) {
  const availableCanon = new Set((pantryItems || []).filter((p) => p && p.level !== "out").map((p) => canonicalize(p.name)));
  const have = [];
  const missing = [];
  const coreMissing = [];
  recipe.ingredients.forEach((ing) => {
    if (availableCanon.has(canonicalize(ing.name))) {
      have.push(ing.name);
    } else {
      missing.push(ing.name);
      if (ing.core) coreMissing.push(ing.name);
    }
  });
  const total = recipe.ingredients.length;
  const ratio = total === 0 ? 1 : have.length / total;
  return { have, missing, coreMissing, ratio };
}

// Default cuisine weighting for a Bangkok household with an Indian kitchen —
// the AI planner (§6) gets this same bias in its prompt.
const DEFAULT_CUISINE_BIAS = { indian: 1.3, thai: 1.3, other: 1 };

// Ranked recipe suggestions. Deterministic — no Math.random, same inputs
// always produce the same output. Ranking, in order:
//   1. hard filters: allergens/avoid (normalised substring, incl. synonyms),
//      kidSafe, slot match — these NEVER just penalize, they exclude.
//   2. fewest coreMissing, then most low/near-expiry pantry items consumed
//      ("use it up wins"), then cuisineBias, then coverage ratio.
//   3. variety pass: never the same cuisine more than twice running.
function suggest(pantryItems, { count, slots, avoid, allergens, kidSafe, cuisineBias, diets, minProteinG, minFiberG } = {}) {
  const wantCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 6;
  const slotFilter = Array.isArray(slots) && slots.length ? slots : null;
  const excludeTerms = [].concat(avoid || [], allergens || []);
  const bias = Object.assign({}, DEFAULT_CUISINE_BIAS, cuisineBias || {});

  const today = todayYMD();
  const soonCutoff = addDaysYMD(today, 5);
  const pantryFlags = (pantryItems || [])
    .filter((p) => p && p.level !== "out")
    .map((p) => ({
      canon: canonicalize(p.name),
      usefulToClear: p.level === "low" || (!!p.expiresOn && p.expiresOn >= today && p.expiresOn <= soonCutoff),
    }));

  const candidates = RECIPES.filter((r) => {
    if (slotFilter && !r.slots.some((s) => slotFilter.includes(s))) return false;
    if (kidSafe && !r.kidFriendly) return false;
    if (excludeTerms.length && recipeMatchesAnyTerm(r, excludeTerms)) return false;
    // Diet/macro floors are a filter of last resort: if they'd leave nothing
    // to cook, the caller still gets a plan (with swaps attached) rather than
    // an empty week — handled by the relaxation below.
    if (!passesDietary(r, { diets, minProteinG, minFiberG })) return false;
    return true;
  });
  // Relax the MACRO floors (never the diets, never the allergens) exactly once
  // when they'd leave nothing to cook — a week with slightly-under-target
  // dinners beats an empty planner. Diets stay enforced, so this can't loop.
  if (!candidates.length && (Number.isFinite(minProteinG) || Number.isFinite(minFiberG))) {
    return suggest(pantryItems, { count, slots, avoid, allergens, kidSafe, cuisineBias, diets });
  }

  function useItUpScore(recipe) {
    const ingredientCanons = new Set(recipe.ingredients.map((i) => canonicalize(i.name)));
    let score = 0;
    pantryFlags.forEach((p) => {
      if (p.usefulToClear && ingredientCanons.has(p.canon)) score++;
    });
    return score;
  }

  const scored = candidates.map((r) => {
    const cov = coverage(r, pantryItems);
    return {
      recipe: r,
      coreMissing: cov.coreMissing.length,
      useItUp: useItUpScore(r),
      bias: bias[r.cuisine] != null ? bias[r.cuisine] : 1,
      ratio: cov.ratio,
    };
  });

  scored.sort((a, b) => {
    if (a.coreMissing !== b.coreMissing) return a.coreMissing - b.coreMissing;
    if (a.useItUp !== b.useItUp) return b.useItUp - a.useItUp;
    if (a.bias !== b.bias) return b.bias - a.bias;
    if (a.ratio !== b.ratio) return b.ratio - a.ratio;
    return a.recipe.id < b.recipe.id ? -1 : a.recipe.id > b.recipe.id ? 1 : 0;
  });

  const remaining = scored.map((s) => s.recipe);

  // Variety pass: at each step take the best-ranked REMAINING candidate that
  // wouldn't make three of the same cuisine run in a row. A candidate that's
  // skipped this round stays in `remaining` and is reconsidered on every
  // later step (unlike a single defer-to-the-end pass, which would starve a
  // heavily-favoured cuisine down to two picks total the moment its first
  // two entries landed back to back).
  const result = [];
  while (result.length < wantCount && remaining.length) {
    const n = result.length;
    let idx = remaining.findIndex((r) => {
      if (n < 2) return true;
      return !(result[n - 1].cuisine === r.cuisine && result[n - 2].cuisine === r.cuisine);
    });
    if (idx === -1) idx = 0; // every remaining candidate would violate — variety is impossible, take the best-ranked one anyway
    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  return result;
}

module.exports = {
  all,
  byId,
  search,
  coverage,
  suggest,
  SYNONYMS,
  CUISINES,
  SLOTS,
  INGREDIENT_CATEGORIES,
  ALLERGENS,
  // household diets, macro floors, staples
  DIETS,
  STAPLES,
  swapsFor,
  fitsDiets,
  estimateFiberG,
  allergenInIngredient,
  // exposed for tests / debugging matching behaviour, not part of the §8b contract
  normalize,
  canonicalize,
  namesMatch,
};
