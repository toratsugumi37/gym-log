// Apps Script 웹앱 호출. CORS 제약 때문에 POST는 text/plain으로 보낸다
// (application/json이면 GAS가 preflight를 처리하지 못한다).

import { ensureConfig } from './config.js';

export async function apiGet(params) {
  const config = ensureConfig();
  if (!config) throw new Error('설정 없음');
  const qs = new URLSearchParams({ ...params, token: config.token });
  const res = await fetch(`${config.url}?${qs}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API 오류');
  return data;
}

export async function apiPost(body) {
  const config = ensureConfig();
  if (!config) throw new Error('설정 없음');
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token: config.token }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API 오류');
  return data;
}

export async function cachedGet(params, cacheKey, storage = localStorage) {
  const key = `gymlog.cache.${cacheKey}`;
  try {
    const data = await apiGet(params);
    storage.setItem(key, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    const cached = storage.getItem(key);
    if (cached) return { data: JSON.parse(cached), offline: true };
    throw err;
  }
}
