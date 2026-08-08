/* ============================================================
   TODAY SETUP GUIDE — pure state + family-scoped UI preference helpers.
   The dashboard supplies the existing family, school-feed, and action state;
   this file never creates or changes server data.
============================================================ */
(function (root) {
  "use strict";

  const STEP_DEFINITIONS = [
    { id: "kid", label: "Add your first kid", description: "Create a kid profile so the family plan has someone to organize around." },
    { id: "parent", label: "Invite your co-parent", description: "Share the family code so another parent can join on their own device." },
    { id: "school", label: "Connect a school calendar", description: "Bring school dates into the family calendar automatically." },
    { id: "action", label: "Create your first shared action", description: "Add one next step so Today can keep the family moving." },
  ];

  function parentCount(family) {
    if (!family) return 0;
    if (Array.isArray(family.parentIds)) return family.parentIds.length;
    return Array.isArray(family.parents) ? family.parents.length : 0;
  }

  function dataKnown(value) {
    return value !== null && typeof value !== "undefined";
  }

  function derive(family, schoolFeeds, actions, actionState) {
    const familyLoaded = !!family;
    const kids = familyLoaded && Array.isArray(family.kids) ? family.kids : [];
    const schoolLoaded = dataKnown(schoolFeeds);
    const actionLoaded = actionState !== "loading" && actionState !== "error" && dataKnown(actions);
    const staleActionsAvailable = Array.isArray(actions) && actions.length > 0;
    const steps = STEP_DEFINITIONS.map((definition) => {
      let complete = false;
      let pending = false;
      if (definition.id === "kid") {
        complete = familyLoaded && kids.length > 0;
        pending = !familyLoaded;
      } else if (definition.id === "parent") {
        complete = familyLoaded && parentCount(family) >= 2;
        pending = !familyLoaded;
      } else if (definition.id === "school") {
        complete = schoolLoaded && Array.isArray(schoolFeeds.subscriptions) && schoolFeeds.subscriptions.length > 0;
        pending = !schoolLoaded;
      } else if (definition.id === "action") {
        complete = staleActionsAvailable || (actionLoaded && actions.length > 0);
        pending = !complete && !actionLoaded;
      }
      return Object.assign({}, definition, { complete, pending });
    });
    return {
      steps,
      complete: steps.every((step) => step.complete),
      pending: steps.some((step) => step.pending),
      familyLoaded,
    };
  }

  function storageKey(familyId) {
    return familyId ? `fam_setup_skipped_${familyId}` : "";
  }

  function isSkipped(familyId) {
    const key = storageKey(familyId);
    if (!key || !root.localStorage) return false;
    try { return root.localStorage.getItem(key) === "1"; } catch (e) { return false; }
  }

  function setSkipped(familyId, skipped) {
    const key = storageKey(familyId);
    if (!key || !root.localStorage) return false;
    try {
      if (skipped) root.localStorage.setItem(key, "1");
      else root.localStorage.removeItem(key);
      return true;
    } catch (e) { return false; }
  }

  root.famTodaySetupGuide = {
    derive,
    parentCount,
    storageKey,
    isSkipped,
    setSkipped,
    stepDefinitions: STEP_DEFINITIONS.map((step) => Object.assign({}, step)),
  };
})(typeof window !== "undefined" ? window : globalThis);
