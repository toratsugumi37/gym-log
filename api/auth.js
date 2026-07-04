import bcrypt from 'bcryptjs';
import { q } from './_lib/db.js';
import { createSession, destroySession, requireUser } from './_lib/session.js';
import { validateJoin, validateProfile } from './_lib/validate.js';
import { requireJson } from './_lib/http.js';

function userPayload(row) {
  return {
    username: row.username,
    nickname: row.nickname,
    birthYear: row.birth_year,
    gender: row.gender,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    goalWeight: row.goal_weight === null ? null : Number(row.goal_weight),
    goalText: row.goal_text,
  };
}

export default async function handler(req, res) {
  const action = req.query.action;
  if (!requireJson(req, res)) return;
  try {
    if (req.method === 'GET' && action === 'me') return await me(req, res);
    if (req.method === 'POST' && action === 'join') return await join(req, res);
    if (req.method === 'POST' && action === 'login') return await login(req, res);
    if (req.method === 'POST' && action === 'logout') return await logout(req, res);
    if (req.method === 'POST' && action === 'profile') return await profile(req, res);
    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}

async function join(req, res) {
  const v = validateJoin(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const u = v.value;
  const hash = await bcrypt.hash(u.password, 10);
  let result;
  try {
    result = await q(
      `INSERT INTO users (username, password_hash, nickname, birth_year, gender, height_cm, goal_weight, goal_text)
       VALUES (?,?,?,?,?,?,?,?)`,
      [u.username, hash, u.nickname, u.birthYear, u.gender, u.heightCm, u.goalWeight, u.goalText],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: '이미 있는 아이디예요' });
    }
    throw err;
  }
  await createSession(res, result.insertId);
  const rows = await q('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function login(req, res) {
  const { username, password } = req.body || {};
  const rows = await q('SELECT * FROM users WHERE username = ?', [String(username || '')]);
  const bad = () => res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 틀렸어요' });
  if (!rows.length) return bad();
  const match = await bcrypt.compare(String(password || ''), rows[0].password_hash);
  if (!match) return bad();
  await createSession(res, rows[0].id);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function logout(req, res) {
  await destroySession(req, res);
  return res.json({ ok: true });
}

async function me(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const rows = await q('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows.length) return res.status(401).json({ ok: false, error: 'unauthorized' });
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function profile(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const v = validateProfile(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const p = v.value;
  await q(
    'UPDATE users SET nickname=?, birth_year=?, gender=?, height_cm=?, goal_weight=?, goal_text=? WHERE id=?',
    [p.nickname, p.birthYear, p.gender, p.heightCm, p.goalWeight, p.goalText, userId],
  );
  const rows = await q('SELECT * FROM users WHERE id = ?', [userId]);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}
