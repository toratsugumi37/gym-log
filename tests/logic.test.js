import test from 'node:test';
import assert from 'node:assert/strict';
import logic from '../apps-script/logic.cjs';

const rows = [
  ['2026-07-01', '벤치프레스', 60, 10, 1, 'a1'],
  ['2026-07-01', '벤치프레스', 60, 8, 2, 'a2'],
  ['2026-07-01', '스쿼트', 80, 5, 1, 'a3'],
  ['2026-07-03', '벤치프레스', 62.5, 10, 1, 'b1'],
  ['2026-07-04', '스쿼트', 85, 5, 1, 'c1'],
];
const records = logic.rowsToRecords(rows);

test('rowsToRecords: 행을 레코드 객체로 변환', () => {
  assert.deepEqual(records[0], {
    date: '2026-07-01', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'a1',
  });
});

test('recordsOnDate: 해당 날짜 기록만', () => {
  assert.equal(logic.recordsOnDate(records, '2026-07-01').length, 3);
});

test('lastSession: 기준일 이전 가장 최근 세션', () => {
  const last = logic.lastSession(records, '벤치프레스', '2026-07-04');
  assert.equal(last.length, 1);
  assert.equal(last[0].id, 'b1');
});

test('lastSession: 기록 없으면 빈 배열', () => {
  assert.deepEqual(logic.lastSession(records, '데드리프트', '2026-07-04'), []);
});

test('recentExercises: 최근 사용순 중복 제거', () => {
  assert.deepEqual(logic.recentExercises(records), ['스쿼트', '벤치프레스']);
});

test('chartSeries: 날짜별 최고 무게, 날짜 오름차순', () => {
  assert.deepEqual(logic.chartSeries(records, '벤치프레스'), [
    { date: '2026-07-01', weight: 60 },
    { date: '2026-07-03', weight: 62.5 },
  ]);
});

test('hasId: 중복 ID 감지', () => {
  assert.equal(logic.hasId(records, 'a1'), true);
  assert.equal(logic.hasId(records, 'zzz'), false);
});
