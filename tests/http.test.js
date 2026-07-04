import test from 'node:test';
import assert from 'node:assert/strict';
import { requireJson } from '../api/_lib/http.js';

function fakeRes() {
  const res = { statusCode: 0, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

test('requireJson: GET은 통과', () => {
  const res = fakeRes();
  assert.equal(requireJson({ method: 'GET', headers: {} }, res), true);
});

test('requireJson: JSON POST는 통과', () => {
  const res = fakeRes();
  assert.equal(requireJson({ method: 'POST', headers: { 'content-type': 'application/json' } }, res), true);
});

test('requireJson: 폼 POST는 415로 거부 (CSRF 방어)', () => {
  const res = fakeRes();
  assert.equal(requireJson({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, res), false);
  assert.equal(res.statusCode, 415);
  assert.equal(res.body.ok, false);
});

test('requireJson: Content-Type 없는 POST 거부', () => {
  const res = fakeRes();
  assert.equal(requireJson({ method: 'POST', headers: {} }, res), false);
  assert.equal(res.statusCode, 415);
});
