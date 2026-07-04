// same-origin /api/* 호출. 세션 쿠키는 브라우저가 자동으로 붙인다.

let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (res.status === 401 && data.error === 'unauthorized') {
    onUnauthorized();
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!data.ok) {
    const err = new Error(data.error || 'API 오류');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params);
  return request(`${path}?${qs}`);
}

export async function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function cachedGet(path, params, cacheKey, storage = localStorage) {
  const key = `gymlog.cache.${cacheKey}`;
  try {
    const data = await apiGet(path, params);
    storage.setItem(key, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    if (err.message === 'unauthorized') throw err; // 로그아웃 상태에서 캐시를 보여주면 안 됨
    const cached = storage.getItem(key);
    if (cached) return { data: JSON.parse(cached), offline: true };
    throw err;
  }
}
