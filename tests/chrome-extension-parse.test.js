"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeElement {
  constructor(tagName, attributes) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
  }

  get classList() {
    const classes = (this.attributes.class || "").split(/\s+/).filter(Boolean);
    return { contains: (name) => classes.includes(name) };
  }

  get textContent() {
    return this.children.map((child) => typeof child === "string" ? child : child.textContent).join("");
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const requiredClasses = selector.startsWith(".") ? selector.slice(1).split(".") : [];
    const visit = (node) => {
      if (!(node instanceof FakeElement)) return;
      if (requiredClasses.length && requiredClasses.every((name) => node.classList.contains(name))) {
        matches.push(node);
      }
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document", {});
  }
}

class BrowserlessDOMParser {
  parseFromString(html) {
    const document = new FakeDocument();
    const stack = [document];
    const tokens = String(html || "").match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
    const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

    tokens.forEach((token) => {
      if (token.startsWith("<!--") || token.startsWith("<!")) return;
      if (token.startsWith("</")) {
        const tagName = token.match(/^<\/\s*([^\s>]+)/)?.[1]?.toLowerCase();
        while (stack.length > 1) {
          const current = stack.pop();
          if (current.tagName === tagName) break;
        }
        return;
      }
      if (!token.startsWith("<")) {
        stack[stack.length - 1].appendChild(token);
        return;
      }

      const tagMatch = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!tagMatch) return;
      const tagName = tagMatch[1].toLowerCase();
      const attributeSource = tagMatch[2];
      const attributes = {};
      const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      let attributeMatch;
      while ((attributeMatch = attributePattern.exec(attributeSource))) {
        attributes[attributeMatch[1].toLowerCase()] = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? "";
      }

      const element = new FakeElement(tagName, attributes);
      stack[stack.length - 1].appendChild(element);
      if (!voidTags.has(tagName) && !/\/\s*>$/.test(token)) stack.push(element);
    });

    return document;
  }
}

const source = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "parse.js"), "utf8");
const sandbox = { DOMParser: BrowserlessDOMParser, window: {} };
vm.runInNewContext(source, sandbox, { filename: "chrome-extension/parse.js" });
const parse = sandbox.window.famParse;

test("parses production-shaped Moodle homework and builds the current URL", () => {
  const html = `
    <div class="accordion-item applyhwclass">
      <div class="accordion-header"><span class="subject">Music</span></div>
      <div class="accordion-body">
        <span class="title">Learn the chorus for assembly</span>
        <div class="date" title="It was set Friday">Saturday</div>
      </div>
    </div>
  `;

  const items = parse.parseHomeworkHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].subject, "Music");
  assert.equal(items[0].title, "Learn the chorus for assembly");
  assert.equal(items[0].dueDate, "Saturday");
  assert.equal(items[0].completed, false);
  assert.equal(
    parse.moodleHomeworkUrl("student id/42?term=1&campus=primary"),
    "https://bangkok.learn.nae.school/mod/homework/view.php?h=2&userid=student%20id%2F42%3Fterm%3D1%26campus%3Dprimary&showcompleted=0&limit=0",
  );
});

test("keeps completed-task detection and userid encoding intact", () => {
  const items = parse.parseHomeworkHtml(`
    <div class="accordion-item applyhwclass tickon">
      <span class="subject">Music</span>
      <span class="title">Completed scale practice</span>
      <div class="date" title="This task was completed on Friday\nIt was set Thursday">Friday</div>
    </div>
  `);

  assert.equal(items.length, 1);
  assert.equal(items[0].completed, true);
  assert.equal(
    parse.moodleHomeworkUrl("id with / slash"),
    "https://bangkok.learn.nae.school/mod/homework/view.php?h=2&userid=id%20with%20%2F%20slash&showcompleted=0&limit=0",
  );
});
