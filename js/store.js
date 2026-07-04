// 화면과 무관한 순수 데이터 가공 로직. ui.js에서 import한다.

export function groupByExercise(records) {
  const groups = [];
  const byName = new Map();
  for (const r of records) {
    let g = byName.get(r.exercise);
    if (!g) {
      g = { exercise: r.exercise, sets: [] };
      byName.set(r.exercise, g);
      groups.push(g);
    }
    g.sets.push(r);
  }
  for (const g of groups) g.sets.sort((a, b) => a.set - b.set);
  return groups;
}

export function groupByDate(records) {
  const dates = [...new Set(records.map((r) => r.date))].sort().reverse();
  return dates.map((date) => ({
    date,
    groups: groupByExercise(records.filter((r) => r.date === date)),
  }));
}

export function nextSetNumber(records, exercise) {
  const nums = records.filter((r) => r.exercise === exercise).map((r) => r.set);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function summarizeSession(records) {
  if (!records.length) return null;
  const top = records.reduce((a, b) => (b.weight > a.weight ? b : a));
  return `${top.weight}kg × ${top.reps} × ${records.length}세트`;
}

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function summarizeToday(records) {
  const exercises = new Set(records.map((r) => r.exercise)).size;
  const sets = records.length;
  const volume = records.reduce((s, r) => s + r.weight * r.reps, 0);
  return { exercises, sets, volume };
}

const normEx = (s) => String(s).toLowerCase().replace(/\s+/g, '');

export function filterExercises(list, query) {
  const q = normEx(query);
  if (!q) return list.slice();
  return list.filter((name) => normEx(name).includes(q));
}

export function hasExercise(list, name) {
  const target = normEx(name);
  return list.some((e) => normEx(e) === target);
}
