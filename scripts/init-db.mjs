// DATABASE_URL의 DB에 schema.sql을 적용한다.
// 실행: node --env-file=.env scripts/init-db.mjs

import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { configFromUrl } from '../api/_lib/db.js';

const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const conn = await mysql.createConnection({
  ...configFromUrl(process.env.DATABASE_URL),
  multipleStatements: true,
});
await conn.query(sql);
const [tables] = await conn.query('SHOW TABLES');
console.log('적용 완료:', tables.map((t) => Object.values(t)[0]).join(', '));
await conn.end();
