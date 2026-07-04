import { q } from './_lib/db.js';
import { requireUser } from './_lib/session.js';
import { validateBodyEntry } from './_lib/validate.js';

export default async function handler(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const rows = await q(
        'SELECT date, weight, body_fat_pct, muscle_mass FROM body_metrics WHERE user_id=? ORDER BY date',
        [userId],
      );
      return res.json({
        ok: true,
        rows: rows.map((r) => ({
          date: r.date,
          weight: r.weight === null ? null : Number(r.weight),
          bodyFatPct: r.body_fat_pct === null ? null : Number(r.body_fat_pct),
          muscleMass: r.muscle_mass === null ? null : Number(r.muscle_mass),
        })),
      });
    }
    if (req.method === 'POST') {
      const v = validateBodyEntry(req.body || {});
      if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
      const b = v.value;
      if (b.weight === null && b.bodyFatPct === null && b.muscleMass === null) {
        await q('DELETE FROM body_metrics WHERE user_id=? AND date=?', [userId, b.date]);
        return res.json({ ok: true, deleted: true });
      }
      await q(
        `INSERT INTO body_metrics (user_id, date, weight, body_fat_pct, muscle_mass)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE weight=VALUES(weight), body_fat_pct=VALUES(body_fat_pct), muscle_mass=VALUES(muscle_mass)`,
        [userId, b.date, b.weight, b.bodyFatPct, b.muscleMass],
      );
      return res.json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}
