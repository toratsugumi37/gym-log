import test from 'node:test';
import assert from 'node:assert/strict';
import { configFromUrl } from '../api/_lib/db.js';

test('configFromUrl: URL을 mysql2 설정으로 변환 (TLS 필수)', () => {
  const c = configFromUrl('mysql://user1:p%40ss@gateway.tidbcloud.com:4000/gymlog');
  assert.equal(c.host, 'gateway.tidbcloud.com');
  assert.equal(c.port, 4000);
  assert.equal(c.user, 'user1');
  assert.equal(c.password, 'p@ss');
  assert.equal(c.database, 'gymlog');
  assert.equal(c.ssl.rejectUnauthorized, true);
});

test('configFromUrl: 포트 생략 시 4000', () => {
  assert.equal(configFromUrl('mysql://u:p@h/gymlog').port, 4000);
});
