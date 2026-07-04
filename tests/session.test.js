import test from 'node:test';
import assert from 'node:assert/strict';
import { readToken } from '../api/_lib/session.js';

const T = 'a'.repeat(64);

test('readToken: 쿠키에서 sid 추출', () => {
  assert.equal(readToken({ headers: { cookie: `sid=${T}` } }), T);
  assert.equal(readToken({ headers: { cookie: `foo=1; sid=${T}; bar=2` } }), T);
});

test('readToken: 없거나 형식이 다르면 null', () => {
  assert.equal(readToken({ headers: {} }), null);
  assert.equal(readToken({ headers: { cookie: 'sid=short' } }), null);
  assert.equal(readToken({ headers: { cookie: `notsid=${T}` } }), null);
});
