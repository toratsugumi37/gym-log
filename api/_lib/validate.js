// 요청 본문 검증. 전부 순수 함수 — DB/네트워크 접근 금지.

const USERNAME_RE = /^[A-Za-z0-9_]{4,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function optNum(v, min, max) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

function profileFields(b) {
  const birthYear = optNum(b.birthYear, 1900, 2100);
  if (!birthYear.ok) return { ok: false, error: '생년도 값이 이상해요' };
  const gender = b.gender === null || b.gender === undefined || b.gender === '' ? null : b.gender;
  if (gender !== null && gender !== 'm' && gender !== 'f') return { ok: false, error: '성별 값이 이상해요' };
  const heightCm = optNum(b.heightCm, 50, 300);
  if (!heightCm.ok) return { ok: false, error: '키 값이 이상해요' };
  const goalWeight = optNum(b.goalWeight, 10, 500);
  if (!goalWeight.ok) return { ok: false, error: '목표 몸무게 값이 이상해요' };
  const goalText = b.goalText === null || b.goalText === undefined
    ? null
    : String(b.goalText).trim().slice(0, 100) || null;
  return {
    ok: true,
    value: {
      birthYear: birthYear.value,
      gender,
      heightCm: heightCm.value,
      goalWeight: goalWeight.value,
      goalText,
    },
  };
}

export function validateJoin(b) {
  if (!USERNAME_RE.test(b.username || '')) {
    return { ok: false, error: '아이디는 영문/숫자/_ 4~30자예요' };
  }
  if (typeof b.password !== 'string' || b.password.length < 8) {
    return { ok: false, error: '비밀번호는 8자 이상이어야 해요' };
  }
  const nickname = String(b.nickname || '').trim();
  if (!nickname || nickname.length > 30) return { ok: false, error: '닉네임은 1~30자예요' };
  const prof = profileFields(b);
  if (!prof.ok) return prof;
  return { ok: true, value: { username: b.username, password: b.password, nickname, ...prof.value } };
}

export function validateProfile(b) {
  const nickname = String(b.nickname || '').trim();
  if (!nickname || nickname.length > 30) return { ok: false, error: '닉네임은 1~30자예요' };
  const prof = profileFields(b);
  if (!prof.ok) return prof;
  return { ok: true, value: { nickname, ...prof.value } };
}

export function validateSetRecord(r) {
  if (!r || typeof r !== 'object') return { ok: false, error: 'bad record' };
  if (!DATE_RE.test(r.date || '')) return { ok: false, error: 'bad date' };
  const exercise = String(r.exercise || '').trim();
  if (!exercise || exercise.length > 50) return { ok: false, error: 'bad exercise' };
  const weight = Number(r.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) return { ok: false, error: 'bad weight' };
  const reps = Number(r.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) return { ok: false, error: 'bad reps' };
  const set = Number(r.set);
  if (!Number.isInteger(set) || set < 1 || set > 1000) return { ok: false, error: 'bad set' };
  const id = String(r.id || '');
  if (!id || id.length > 40) return { ok: false, error: 'bad id' };
  return { ok: true, value: { date: r.date, exercise, weight, reps, set, id } };
}

export function validateBodyEntry(b) {
  if (!DATE_RE.test(b.date || '')) return { ok: false, error: 'bad date' };
  const weight = optNum(b.weight, 10, 500);
  if (!weight.ok) return { ok: false, error: '몸무게 값이 이상해요' };
  const bodyFatPct = optNum(b.bodyFatPct, 1, 80);
  if (!bodyFatPct.ok) return { ok: false, error: '체지방률 값이 이상해요' };
  const muscleMass = optNum(b.muscleMass, 5, 200);
  if (!muscleMass.ok) return { ok: false, error: '골격근량 값이 이상해요' };
  return {
    ok: true,
    value: { date: b.date, weight: weight.value, bodyFatPct: bodyFatPct.value, muscleMass: muscleMass.value },
  };
}
