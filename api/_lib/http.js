// 상태를 바꾸는 POST는 JSON Content-Type을 요구한다.
// HTML 폼은 application/json을 보낼 수 없으므로 폼 기반 CSRF(로그인 CSRF 포함)를 차단한다.
// 프론트(js/api.js)는 항상 application/json으로 보내므로 정상 요청은 영향받지 않는다.
export function requireJson(req, res) {
  if (req.method !== 'POST') return true;
  const ct = String((req.headers && req.headers['content-type']) || '');
  if (ct.includes('application/json')) return true;
  res.status(415).json({ ok: false, error: 'json required' });
  return false;
}
