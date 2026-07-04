import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
  summarizeToday, filterExercises, hasExercise, formatDateLabel,
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

test('summarizeToday: 종목수·세트수·볼륨 합계', () => {
  const recs = [
    { exercise: '벤치프레스', weight: 60, reps: 10 },
    { exercise: '벤치프레스', weight: 62.5, reps: 8 },
    { exercise: '스쿼트', weight: 80, reps: 5 },
  ];
  assert.deepEqual(summarizeToday(recs), { exercises: 2, sets: 3, volume: 60 * 10 + 62.5 * 8 + 80 * 5 });
  assert.deepEqual(summarizeToday([]), { exercises: 0, sets: 0, volume: 0 });
});

test('filterExercises: 부분일치, 공백·대소문자 무시', () => {
  const list = ['벤치프레스', '인클라인 벤치', '스쿼트'];
  assert.deepEqual(filterExercises(list, '벤치'), ['벤치프레스', '인클라인 벤치']);
  assert.deepEqual(filterExercises(list, '인클라인벤치'), ['인클라인 벤치']);
  assert.deepEqual(filterExercises(list, ''), list);
  assert.deepEqual(filterExercises(list, '데드'), []);
});

test('hasExercise: 공백·대소문자 무시 정확일치', () => {
  const list = ['벤치프레스', 'Lat Pulldown'];
  assert.equal(hasExercise(list, '벤치프레스'), true);
  assert.equal(hasExercise(list, 'lat  pulldown'), true);
  assert.equal(hasExercise(list, '벤치'), false);
});

test('formatDateLabel: M월 D일 (요일), 로컬 기준', () => {
  assert.equal(formatDateLabel('2026-07-05'), '7월 5일 (일)'); // 2026-07-05는 일요일
  assert.equal(formatDateLabel('2026-07-06'), '7월 6일 (월)');
  assert.equal(formatDateLabel('2026-12-25'), '12월 25일 (금)'); // 2026-12-25는 금요일
});
