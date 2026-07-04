// Apps Script 웹앱 URL과 비밀 토큰을 localStorage에 보관한다.
// 공개 저장소에 하드코딩하지 않기 위해 최초 접속 시 입력받는다.

const KEY = 'gymlog.config';

export function getConfig(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveConfig(config, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(config));
}

export function ensureConfig() {
  const existing = getConfig();
  if (existing && existing.url && existing.token) return existing;
  const url = (prompt('Apps Script 웹앱 URL을 입력하세요 (…/exec 로 끝나는 주소)') || '').trim();
  const token = (prompt('비밀 토큰을 입력하세요') || '').trim();
  const config = { url, token };
  saveConfig(config);
  return config;
}
