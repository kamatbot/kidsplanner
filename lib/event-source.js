"use strict";

function getFirstName(fullName) {
  if (!fullName || typeof fullName !== "string") return null;
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || null;
}

function resolveMemberName(createdBy, family) {
  if (!createdBy || !family) return null;

  if (typeof family.resolveName === "function") {
    const resolved = family.resolveName(createdBy);
    if (resolved) return resolved;
  }

  if (family.names && typeof family.names === "object" && family.names[createdBy]) {
    return family.names[createdBy];
  }

  if (Array.isArray(family.parents)) {
    const p = family.parents.find((x) => x && (x.id === createdBy || x.userId === createdBy));
    if (p && p.name) return p.name;
  }

  if (Array.isArray(family.kids)) {
    const k = family.kids.find((x) => x && (x.id === createdBy || x.userId === createdBy));
    if (k && k.name) return k.name;
  }

  if (Array.isArray(family.members)) {
    const m = family.members.find((x) => x && (x.id === createdBy || x.userId === createdBy));
    if (m && m.name) return m.name;
  }

  return null;
}

/**
 * Pure server function to derive a human source label for any calendar event.
 *
 * @param {Object} event - The calendar event object.
 * @param {Object} [family] - The family record or enriched family context with member names.
 * @returns {string} Human source label (e.g. "School", "Your calendar", "Trip", "Hermes", "Added by <name>").
 */
function sourceLabel(event, family) {
  if (!event || typeof event !== "object") return "";

  // 1. School feed events
  if (event.source === "school" || event.sourceType === "school" || event.sourceType === "school-api") {
    // Built-in feeds carry a feedId; custom iCal subscriptions do not.
    if (event.source === "school" && !event.feedId) return "Your calendar";
    return "School";
  }

  // 2. Trip events
  if (event.source === "trip" || event.sourceType === "trip" || (event.category === "trip" && String(event.id || "").startsWith("trip_"))) {
    return "Trip";
  }

  // 3. Hermes-created events
  if (
    event.sourceType === "operator" ||
    event.sourceType === "hermes" ||
    event.createdBy === "hermes" ||
    event.source === "hermes"
  ) {
    return "Hermes";
  }

  // 4. Guesses
  if (event.source === "guess" || event.isGuess) {
    return "Guess";
  }

  // 5. Meals
  if (event.source === "menu") {
    return "Meal";
  }

  // 6. Manual events
  if (event.source === "manual" || event.createdBy !== undefined) {
    const fullName = resolveMemberName(event.createdBy, family);
    const firstName = getFirstName(fullName);
    if (firstName) {
      return `Added by ${firstName}`;
    }
    return "Added";
  }

  return "Calendar";
}

module.exports = {
  sourceLabel,
  getFirstName,
  resolveMemberName,
};
