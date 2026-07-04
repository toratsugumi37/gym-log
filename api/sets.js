import { q } from './_lib/db.js';
import { requireUser } from './_lib/session.js';
import { validateSetRecord } from './_lib/validate.js';
import { requireJson } from './_lib/http.js';

function rowToRecord(r) {
  return {
    id: r.client_id,
    date: r.date,
    exercise: r.exercise,
    weight: Number(r.weight),
    reps: r.reps,
    set: r.set_no,
  };
}

export default async function handler(req, res) {
  if (!requireJson(req, res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') return await get(req, res, userId);
    if (req.method === 'POST') return await post(req, res, userId);
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}

async function get(req, res, userId) {
  const p = req.query;
  if (p.action === 'today') {
    const rows = await q(
      'SELECT * FROM workout_sets WHERE user_id=? AND date=? ORDER BY id',
      [userId, String(p.date || '')],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'history') {
    const days = Math.min(Number(p.days) || 90, 365);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = await q(
      'SELECT * FROM workout_sets WHERE user_id=? AND date>=? ORDER BY id',
      [userId, cutoff],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'last') {
    const rows = await q(
      `SELECT * FROM workout_sets
       WHERE user_id=? AND exercise=? AND date = (
         SELECT MAX(date) FROM workout_sets WHERE user_id=? AND exercise=? AND date < ?
       ) ORDER BY set_no`,
      [userId, String(p.exercise || ''), userId, String(p.exercise || ''), String(p.before || '')],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'exercises') {
    const rows = await q(
      'SELECT exercise FROM workout_sets WHERE user_id=? GROUP BY exercise ORDER BY MAX(id) DESC LIMIT 30',
      [userId],
    );
    return res.json({ ok: true, exercises: rows.map((r) => r.exercise) });
  }
  if (p.action === 'chart') {
    const rows = await q(
      'SELECT date, MAX(weight) AS w FROM workout_sets WHERE user_id=? AND exercise=? GROUP BY date ORDER BY date',
      [userId, String(p.exercise || '')],
    );
    return res.json({ ok: true, series: rows.map((r) => ({ date: r.date, weight: Number(r.w) })) });
  }
  return res.status(400).json({ ok: false, error: 'unknown action' });
}

async function post(req, res, userId) {
  const body = req.body || {};
  if (body.action === 'add') {
    const v = validateSetRecord(body.record);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
    const r = v.value;
    try {
      await q(
        `INSERT INTO workout_sets (user_id, date, exercise, weight, reps, set_no, client_id)
         VALUES (?,?,?,?,?,?,?)`,
        [userId, r.date, r.exercise, r.weight, r.reps, r.set, r.id],
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.json({ ok: true, duplicate: true });
      throw err;
    }
    return res.json({ ok: true });
  }
  if (body.action === 'delete') {
    const result = await q(
      'DELETE FROM workout_sets WHERE user_id=? AND client_id=?',
      [userId, String(body.id || '')],
    );
    if (result.affectedRows === 0) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: 'unknown action' });
}
