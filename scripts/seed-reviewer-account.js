"use strict";
require("../lib/loadenv").load();
const reviewerAccount = require("../lib/reviewer-account");

console.log("[seed-reviewer-account] Ensuring App Store review account exists...");
const result = reviewerAccount.ensureReviewerAccount();
console.log("[seed-reviewer-account] Result:");
console.log(JSON.stringify(result, null, 2));
