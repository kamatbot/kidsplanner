'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('../lib/routes/student-support');

function harness() {
  const routes = {}, calls = [];
  register({
    get: (p, ...h) => routes.GET = h,
    post: (p, ...h) => routes.POST = h
  }, {
    requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({
      error: 'auth'
    }),
    requireFamily: (req, res, next) => next(),
    requireHub: (req, res, next) => next(),
    userRole: u => u.role,
    kidIdForUser: req => req.user.kidId,
    studentSupport: {
      getSnapshot: (...args) => {
        calls.push(args);
        return {
          kidId: args[1]
        };
      },
      command: (...args) => {
        calls.push(args);
        return {
          kidId: args[1]
        };
      }
    }
  });
  function call(method, overrides = {}) {
    const req = {
      user: {
        id: 'u',
        role: 'kid',
        kidId: 'k'
      },
      family: {
        id: 'f',
        kids: [ {
          id: 'k'
        }, {
          id: 'sibling'
        }]
      },
      query: {
        kidId: 'sibling'
      },
      body: {
        kidId: 'k'
      },
      ...overrides
    };
    const res = {
      statusCode: 200,
      headers: {},
      set(k, v) {
        this.headers[k] = v;
        return this;
      },
      status(s) {
        this.statusCode = s;
        return this;
      },
      json(v) {
        this.body = v;
        return this;
      }
    };
    let index = 0;
    const next = () => {
      const handler = routes[method][index++];
      if (handler) handler(req, res, next);
    };
    next();
    return res;
  }
  return {
    call,
    calls
  };
}
test('child GET forces own identity, Watch parents denied, sibling/out-of-family writes denied', () => {
  const {
    call,
    calls
  } = harness();
  assert.equal(call('GET').body.support.kidId, 'k');
  assert.equal(call('GET').headers['Cache-Control'], 'no-store');
  assert.equal(call('POST', {
    body: {
      kidId: 'sibling'
    }
  }).statusCode, 403);
  assert.equal(call('GET', {
    watchAuth: {},
    user: {
      id: 'p',
      role: 'parent'
    }
  }).statusCode, 403);
  assert.equal(call('GET', {
    user: {
      id: 'p',
      role: 'parent'
    },
    query: {
      kidId: 'foreign'
    }
  }).statusCode, 404);
  assert.equal(calls.length, 2);
});
test('interactive parent selects a family child and child Watch passes scoped actor metadata', () => {
  const {
    call,
    calls
  } = harness();
  assert.equal(call('GET', {
    user: {
      id: 'p',
      role: 'parent'
    }
  }).body.support.kidId, 'sibling');
  assert.equal(call('POST', {
    watchAuth: {
      id: 'device'
    }
  }).statusCode, 200);
  assert.deepEqual(calls[1][2], {
    userId: 'u',
    parent: false,
    watch: true
  });
  assert.equal(call('GET', {
    user: null
  }).statusCode, 401);
});
