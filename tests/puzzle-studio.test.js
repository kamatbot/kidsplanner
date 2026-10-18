'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCircuit, trace, ports, visualMarkup } = require('../public/js/puzzle-studio');
const learningRoutes = require('../lib/routes/learning');

test('500 circuit seeds start unsolved and have a connected valid solution', () => {
  const layouts = new Set();
  for (let seed = 1; seed <= 500; seed++) {
    const board = makeCircuit(seed);
    assert.equal(trace(board.tiles).solved, false);
    assert.equal(new Set(board.path).size, board.path.length);
    board.path.forEach(i => { board.tiles[i].turn = board.tiles[i].solution; });
    assert.equal(trace(board.tiles).solved, true, `seed ${seed}`);
    layouts.add(board.path.join(','));
    for (const tile of board.tiles) assert.deepEqual(ports(tile, tile.turn + 4), ports(tile));
  }
  assert.ok(layouts.size > 40);
  assert.deepEqual(makeCircuit(12), makeCircuit(12));
});

test('visual boards retain all 25 cells, row geometry and escaped fallback', () => {
  const html = visualMarkup({ kind: 'path', alt: 'A "safe" grid', columns: 5, items: Array(25).fill('wall') });
  assert.equal((html.match(/class="reasoning-piece/g) || []).length, 25);
  assert.match(html, /--visual-columns:5/);
  assert.match(html, /A &quot;safe&quot; grid/);
  assert.match(visualMarkup({ kind: 'sequence', items: ['<script>'], alt: '' }), /&lt;script&gt;/);
  assert.equal(visualMarkup({ kind: 'invalid', items: [] }), '');
});

test('practice route requires authentication and family, has no player or reward writes', () => {
  const routes = {}, calls = [];
  const auth = (req, res, next) => req.user ? next() : res.status(401).json({});
  const family = (req, res, next) => req.family ? next() : res.status(403).json({});
  learningRoutes({ get: (path, ...handlers) => { routes[path] = handlers; }, post() {}, patch() {}, delete() {} }, {
    requireAuth: auth, requireFamily: family,
    brainteaser: { getPractice: count => { calls.push(count); return { questions: [], count: 0 }; } },
  });
  function run(user, fam) {
    const req = { user, family: fam, query: { count: '6' } };
    const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, set(k,v) { this.headers[k] = v; }, json(body) { this.body = body; } };
    let index = 0;
    const next = () => routes['/api/brainteaser/practice'][index++]?.(req, res, next);
    next(); return res;
  }
  assert.equal(run(null, null).code, 401);
  assert.equal(run({ id: 'kid' }, null).code, 403);
  assert.deepEqual(calls, []);
  const result = run({ id: 'kid', role: 'kid' }, { id: 'family' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(calls, [6]);
});
