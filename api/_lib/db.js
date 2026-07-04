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

export async function q(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}
