// 세션 토큰 발급/검증. remember me = 90일 httpOnly 쿠키.

import crypto from 'node:crypto';
import { q } from './db.js';

const MAX_AGE_SEC = 90 * 24 * 60 * 60;

export function readToken(req) {
  const cookie = (req.headers && req.headers.cookie) || '';
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
  return m ? m[1] : null;
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))',
    [token, userId],
  );
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SEC}; Path=/`,
  );
}

export async function requireUser(req, res) {
  const token = readToken(req);
  if (token) {
    const rows = await q(
      'SELECT user_id FROM sessions WHERE token = ? AND expires_at > NOW()',
      [token],
    );
    if (rows.length) return rows[0].user_id;
  }
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return null;
}

export async function destroySession(req, res) {
  const token = readToken(req);
  // 쿠키 만료는 DB 삭제 성공 여부와 무관하게 항상 내려보낸다.
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  if (token) await q('DELETE FROM sessions WHERE token = ?', [token]);
}
