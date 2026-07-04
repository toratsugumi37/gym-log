// TiDB Serverless(MySQL 호환) 연결. 서버리스 함수 인스턴스당 풀 1개를 재사용한다.

import mysql from 'mysql2/promise';

export function configFromUrl(urlStr) {
  const u = new URL(urlStr);
  return {
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionLimit: 1,
    maxIdle: 1,
  };
}

let pool;

export function getPool() {
  if (!pool) pool = mysql.createPool(configFromUrl(process.env.DATABASE_URL));
  return pool;
}

// TiDB Serverless는 유휴 커넥션을 서버 쪽에서 끊는데, 서버리스 인스턴스가 그보다
// 오래 warm 상태로 남으면 풀에 죽은 커넥션이 남는다. 커넥션 수준 오류는 1회 재시도한다.
// (일반 SQL 오류는 재시도하지 않는다 — ER_DUP_ENTRY 멱등 처리 등이 그대로 동작해야 함)
const RETRYABLE = new Set([
  'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ECONNREFUSED',
]);

export async function q(sql, params = []) {
  try {
    const [rows] = await getPool().execute(sql, params);
    return rows;
  } catch (err) {
    if (err && (err.fatal || RETRYABLE.has(err.code))) {
      const [rows] = await getPool().execute(sql, params);
      return rows;
    }
    throw err;
  }
}
