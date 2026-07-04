import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../js/queue.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test('push/all/remove/size 기본 동작', () => {
  const q = createQueue(fakeStorage());
  assert.deepEqual(q.all(), []);
  q.push({ id: 'a' });
  q.push({ id: 'b' });
  assert.equal(q.size(), 2);
  q.remove('a');
  assert.deepEqual(q.all().map((r) => r.id), ['b']);
});

test('같은 storage로 다시 만들어도 데이터 유지 (영속화)', () => {
  const storage = fakeStorage();
  createQueue(storage).push({ id: 'a' });
  assert.equal(createQueue(storage).size(), 1);
});
