import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
} from '../js/store.js';

const records = [
  { date: '2026-07-04', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'a1' },
  { date: '2026-07-04', exercise: '스쿼트', weight: 80, reps: 5, set: 1, id: 'a2' },
  { date: '2026-07-04', exercise: '벤치프레스', weight: 62.5, reps: 8, set: 2, id: 'a3' },
];

test('groupByExercise: 종목별로 묶고 첫 등장 순서 유지, 세트 정렬', () => {
  const groups = groupByExercise(records);
  assert.deepEqual(groups.map((g) => g.exercise), ['벤치프레스', '스쿼트']);
  assert.deepEqual(groups[0].sets.map((s) => s.set), [1, 2]);
});

test('nextSetNumber: 최대 세트번호 + 1, 없으면 1', () => {
  assert.equal(nextSetNumber(records, '벤치프레스'), 3);
  assert.equal(nextSetNumber(records, '데드리프트'), 1);
});

test('summarizeSession: 최고 무게 세트 기준 요약', () => {
  const bench = records.filter((r) => r.exercise === '벤치프레스');
  assert.equal(summarizeSession(bench), '62.5kg × 8 × 2세트');
  assert.equal(summarizeSession([]), null);
});

test('todayStr: 로컬 날짜 YYYY-MM-DD', () => {
  assert.equal(todayStr(new Date(2026, 6, 4)), '2026-07-04');
});

test('newId: 매번 다른 값', () => {
  assert.notEqual(newId(), newId());
});

test('groupByDate: 최근 날짜부터', () => {
  const more = records.concat([
    { date: '2026-07-01', exercise: '스쿼트', weight: 75, reps: 5, set: 1, id: 'z1' },
  ]);
  assert.deepEqual(groupByDate(more).map((d) => d.date), ['2026-07-04', '2026-07-01']);
});
