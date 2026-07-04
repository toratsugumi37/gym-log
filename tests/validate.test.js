import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJoin, validateProfile, validateSetRecord, validateBodyEntry,
} from '../api/_lib/validate.js';

test('validateJoin: 정상 입력 + 선택 항목 정규화', () => {
  const r = validateJoin({
    username: 'pjy_1', password: 'password1', nickname: ' 근육맨 ',
    birthYear: '1995', gender: 'm', heightCm: '175.5', goalWeight: '', goalText: '벤치 100',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    username: 'pjy_1', password: 'password1', nickname: '근육맨',
    birthYear: 1995, gender: 'm', heightCm: 175.5, goalWeight: null, goalText: '벤치 100',
  });
});

test('validateJoin: 잘못된 아이디/비번/닉네임 거부', () => {
  assert.equal(validateJoin({ username: 'ab', password: 'password1', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: '한글아이디', password: 'password1', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'short', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: '' }).ok, false);
});

test('validateJoin: 선택 항목이 이상하면 거부', () => {
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: 'n', gender: 'x' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: 'n', birthYear: '999' }).ok, false);
});

test('validateProfile: 닉네임 필수, 나머지 선택', () => {
  const r = validateProfile({ nickname: '닉', goalWeight: '80' });
  assert.equal(r.ok, true);
  assert.equal(r.value.goalWeight, 80);
  assert.equal(r.value.heightCm, null);
  assert.equal(validateProfile({ nickname: '' }).ok, false);
});

test('validateSetRecord: 정상/비정상', () => {
  const good = validateSetRecord({ date: '2026-07-04', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'abc-1' });
  assert.equal(good.ok, true);
  assert.equal(validateSetRecord({ date: '26-7-4', exercise: '벤치', weight: 60, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '', weight: 60, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '벤치', weight: -1, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '벤치', weight: 0, reps: 10, set: 1, id: 'a' }).ok, true);
});

test('validateBodyEntry: 수치는 전부 선택, 빈 값은 null', () => {
  const r = validateBodyEntry({ date: '2026-07-04', weight: '81.5', bodyFatPct: '', muscleMass: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { date: '2026-07-04', weight: 81.5, bodyFatPct: null, muscleMass: null });
  assert.equal(validateBodyEntry({ date: 'x' }).ok, false);
});
