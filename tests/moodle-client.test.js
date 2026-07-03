"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const moodleClient = require("../lib/moodle-client");

// ---------- hermetic local HTTP server helper (mirrors school-feeds.test.js) ----------
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

const LOGIN_FORM_HTML = `<html><body><form>
  <input type="hidden" name="logintoken" value="tok123">
  <input type="text" name="username">
  <input type="password" name="password">
</form></body></html>`;

// ---------- login: success ----------
test("login: succeeds when the post-login page shows a logged-in marker", async () => {
  await withServer((req, res) => {
    if (req.method === "GET" && req.url === "/login/index.php") {
      res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "MoodleSession=abc123; Path=/" });
      return res.end(LOGIN_FORM_HTML);
    }
    if (req.method === "POST" && req.url === "/login/index.php") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<html><body><div id="page-my-index"><a href="/login/logout.php">Log out</a></div></body></html>`);
    }
    res.writeHead(404).end();
  }, async (baseUrl) => {
    const result = await moodleClient.login(baseUrl, "parent1", "correct-password");
    assert.equal(result.ok, true);
    assert.equal(result.session.baseUrl, baseUrl);
    assert.ok(result.session.cookies.MoodleSession);
  });
});

// ---------- login: bad credentials ----------
test("login: returns bad_credentials when bounced back to the login form", async () => {
  await withServer((req, res) => {
    if (req.method === "GET" && req.url === "/login/index.php") {
      res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "MoodleSession=abc123; Path=/" });
      return res.end(LOGIN_FORM_HTML);
    }
    if (req.method === "POST" && req.url === "/login/index.php") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<html><body>${LOGIN_FORM_HTML}<div class="loginerrors">Invalid login, please try again</div></body></html>`);
    }
    res.writeHead(404).end();
  }, async (baseUrl) => {
    const result = await moodleClient.login(baseUrl, "parent1", "wrong-password");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_credentials");
  });
});

// ---------- login: SSO detection (no local form at all) ----------
test("login: detects SSO-only tenants (no logintoken form) and returns reason 'sso'", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><a href="/login/oauth2/login.php?id=1">Sign in with Microsoft</a></body></html>`);
  }, async (baseUrl) => {
    const result = await moodleClient.login(baseUrl, "parent1", "whatever");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "sso");
    assert.match(result.error, /Microsoft\/Google/);
  });
});

// ---------- login: SSO detection via redirect ----------
test("login: detects an oauth2 redirect after POST and returns reason 'sso'", async () => {
  await withServer((req, res) => {
    if (req.method === "GET" && req.url === "/login/index.php") {
      res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "MoodleSession=abc123; Path=/" });
      return res.end(LOGIN_FORM_HTML);
    }
    if (req.method === "POST" && req.url === "/login/index.php") {
      res.writeHead(303, { Location: "https://login.microsoftonline.com/common/oauth2/authorize?x=1" });
      return res.end();
    }
    res.writeHead(404).end();
  }, async (baseUrl) => {
    const result = await moodleClient.login(baseUrl, "parent1", "whatever");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "sso");
  });
});

// ---------- login: unreachable ----------
test("login: returns reason 'unreachable' when the portal cannot be reached", async () => {
  const result = await moodleClient.login("http://127.0.0.1:1", "parent1", "whatever");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

// ---------- homework parser ----------
test("parseHomeworkHtml: extracts subject/title/dueDate/setDate/completed from synthetic markup", () => {
  const now = new Date("2026-07-03T00:00:00Z");
  const html = `
    <div class="accordion-item applyhwclass tickon">
      <span class="subject">Mathematics</span>
      <span class="title">Algebra worksheet</span>
      <div class="date" title="This task was completed on Thu 18 June \n It was set Mon 8 June">Thu 18 June</div>
    </div>
    <div class="accordion-item applyhwclass">
      <span class="subject">English</span>
      <span class="title">Essay draft</span>
      <div class="date" title="It was set Tue 30 June">Fri 10 July</div>
    </div>
  `;
  const items = moodleClient.parseHomeworkHtml(html, now);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { subject: "Mathematics", title: "Algebra worksheet", dueDate: "2026-06-18", setDate: "2026-06-08", completed: true });
  assert.deepEqual(items[1], { subject: "English", title: "Essay draft", dueDate: "2026-07-10", setDate: "2026-06-30", completed: false });
});

test("parseHomeworkHtml: infers academic year — Aug-Dec dates use the earlier year, Jan-Jul use the later year", () => {
  // "now" is in Nov 2026 (an Aug-Dec month) -> Aug-Dec dates stay in 2026,
  // Jan-Jul dates roll to 2027 (the second half of the same academic year).
  const now = new Date("2026-11-15T00:00:00Z");
  const html = `
    <div class="accordion-item applyhwclass">
      <span class="subject">Science</span>
      <span class="title">Lab report</span>
      <div class="date" title="It was set Mon 10 November">Fri 14 November</div>
    </div>
    <div class="accordion-item applyhwclass">
      <span class="subject">History</span>
      <span class="title">Essay</span>
      <div class="date" title="It was set Mon 5 January">Fri 9 January</div>
    </div>
  `;
  const items = moodleClient.parseHomeworkHtml(html, now);
  assert.equal(items[0].dueDate, "2026-11-14");
  assert.equal(items[1].dueDate, "2027-01-09");
});

test("parseHomeworkHtml: returns an empty list for HTML with no homework items", () => {
  assert.deepEqual(moodleClient.parseHomeworkHtml("<html><body>No homework here</body></html>"), []);
  assert.deepEqual(moodleClient.parseHomeworkHtml(""), []);
});

// ---------- timetable parser ----------
test("parseTimetableHtml: extracts day/period/time/subject from a synthetic weekly grid", () => {
  const html = `
    <table class="sta_timetable generaltable table">
      <tr><th></th><th>Reg07:45</th><th>P108:00</th><th>P209:00</th></tr>
      <tr>
        <td>Monday</td>
        <td class="cell"><span>Reg</span><span>Andy</span><span>D3p</span></td>
        <td class="cell">Maths Smith Room1</td>
        <td class="cell"></td>
      </tr>
      <tr>
        <td>Tuesday</td>
        <td class="cell">RegAndy D3p Gold</td>
        <td class="cell">English Jones Room2</td>
        <td class="cell">Science Lee Lab1</td>
      </tr>
    </table>
  `;
  const rows = moodleClient.parseTimetableHtml(html);
  const monday = rows.filter((r) => r.day === "Monday");
  assert.equal(monday.length, 2); // empty P2 cell skipped
  assert.deepEqual(monday[0], { day: "Monday", period: "Reg", time: "07:45", subject: "Reg", teacher: "Andy", room: "D3p" });
  assert.equal(monday[1].period, "P1");
  assert.equal(monday[1].time, "08:00");
  assert.equal(monday[1].subject, "Maths Smith Room1"); // no inline spans -> raw concatenated text

  const tuesday = rows.filter((r) => r.day === "Tuesday");
  assert.equal(tuesday.length, 3);
});

test("parseTimetableHtml: returns an empty list when the timetable table is absent", () => {
  assert.deepEqual(moodleClient.parseTimetableHtml("<html><body>No timetable</body></html>"), []);
});

// ---------- helpers ----------
test("extractLoginToken: finds the logintoken hidden input regardless of attribute order", () => {
  assert.equal(moodleClient.extractLoginToken(`<input type="hidden" name="logintoken" value="abc">`), "abc");
  assert.equal(moodleClient.extractLoginToken(`<input value="xyz" type="hidden" name="logintoken">`), "xyz");
  assert.equal(moodleClient.extractLoginToken(`<input name="username">`), null);
});

test("looksLikeSSO: flags oauth2 markup without a local password field", () => {
  assert.equal(moodleClient.looksLikeSSO(`<a href="login/oauth2/login.php">Sign in with Microsoft</a>`), true);
  assert.equal(moodleClient.looksLikeSSO(`<input name="username"><input name="password">`), false);
});
