import test from 'node:test';
import assert from 'node:assert/strict';
import { scalePoints } from '../js/chart.js';

test('scalePoints: x는 균등 분배, 무거울수록 y가 위(작음)', () => {
  const pts = scalePoints(
    [{ date: 'd1', weight: 50 }, { date: 'd2', weight: 100 }], 200, 100, 10);
  assert.equal(pts[0].x, 10);
  assert.equal(pts[1].x, 190);
  assert.equal(pts[0].y, 90);
  assert.equal(pts[1].y, 10);
});

test('scalePoints: 점 하나면 가로 가운데', () => {
  const pts = scalePoints([{ date: 'd1', weight: 50 }], 200, 100, 10);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].x, 100);
});

test('scalePoints: 빈 시리즈는 빈 배열', () => {
  assert.deepEqual(scalePoints([], 200, 100), []);
});

test('scalePoints: extra 값이 범위 계산에 포함됨', () => {
  const pts = scalePoints(
    [{ date: 'd1', weight: 50 }, { date: 'd2', weight: 100 }], 200, 100, 10, [0]);
  // extra 0이 최소값이 되므로 weight 50은 맨 아래(90)가 아니어야 함
  assert.ok(pts[0].y < 90);
  assert.equal(pts[1].y, 10); // 최대는 그대로 100
});
