// Apps Script 웹앱 URL과 비밀 토큰을 localStorage에 보관한다.
// 공개 저장소에 하드코딩하지 않기 위해 최초 접속 시 입력받는다.

const KEY = 'gymlog.config';

// 취소를 눌렀을 때 API 호출마다 프롬프트가 반복해서 뜨지 않도록 로드당 1회만 묻는다.
let promptedThisLoad = false;

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

export function resetConfig(storage = localStorage) {
  storage.removeItem(KEY);
}

export function ensureConfig() {
  const existing = getConfig();
  if (existing && existing.url && existing.token) return existing;
  if (promptedThisLoad) return null;
  promptedThisLoad = true;
  const url = (prompt('Apps Script 웹앱 URL을 입력하세요 (…/exec 로 끝나는 주소)') || '').trim();
  const token = (prompt('비밀 토큰을 입력하세요') || '').trim();
  if (!url || !token) return null;
  const config = { url, token };
  saveConfig(config);
  return config;
}
