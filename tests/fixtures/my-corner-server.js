// Synthetic local fixture only. Start from the repository root under Node 24.
process.env.FAM_DATA_DIR = require('node:fs').mkdtempSync(require('node:path').resolve('.dev-data/corner-qa-'));
process.env.PORT = '18369';
process.env.SESSION_SECRET = 'corner-local-synthetic-session-only';
process.env.DATA_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.NODE_ENV = 'test';
const store = require('../../lib/store');
const family = require('../../lib/family');
const db = require('../../lib/db');
const Keygrip = require('keygrip');
const parent = store.createUser('corner-ui@example.test', 'Corner Parent');
const fam = family.createFamily(parent.id, 'Corner Test Family');
const kid = family.addKid(fam.id, parent.id, { name: 'Maya', grade: '6' }).kid;
const child = store.findOrCreateKidUser(fam.id, kid.id, kid.name);
const sibling = family.addKid(fam.id, parent.id, { name: 'Leo', grade: '7' }).kid;
const child2 = store.findOrCreateKidUser(fam.id, sibling.id, sibling.name);
function cookie(user) {
 const value = Buffer.from(JSON.stringify({uid:user.id,authGen:store.sessionGeneration(user)})).toString('base64');
 return `fam_sess=${value}; fam_sess.sig=${new Keygrip([process.env.SESSION_SECRET]).sign(`fam_sess=${value}`)}`;
}
db.flushSync();
const corner = require('../../lib/my-corner');
const read = corner.read, save = corner.save;
let failNext = null;
function fail(operation) {
 if (failNext !== operation) return;
 failNext = null;
 throw Object.assign(new Error('Synthetic ' + operation + ' failure. Please retry.'), { status: 503 });
}
corner.read = (...args) => { fail('load'); return read(...args); };
corner.save = (...args) => { fail('save'); return save(...args); };
const app = require('../../server');
app.post('/qa/my-corner-failure', (req, res) => {
 if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return res.sendStatus(403);
 failNext = req.body.operation;
 res.json({ ok: true });
});
app.get('/qa/my-corner-session', (req, res) => {
 if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return res.sendStatus(403);
 res.json({ child: cookie(child), sibling: cookie(child2), parent: cookie(parent) });
});
