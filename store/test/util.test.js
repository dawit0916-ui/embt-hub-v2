import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AppError,
  hmac,
  linkCode,
  needInt,
  needPackage,
  numericCode,
  safeEqual,
  signPayload,
  verifyPayload,
} from '../util.js';

test('codes have the right shape', () => {
  assert.match(linkCode(), /^[A-HJKMNP-Z2-9]{8}$/);
  for (let i = 0; i < 50; i++) assert.match(numericCode(), /^\d{6}$/);
});

test('hmac is deterministic and keyed', () => {
  assert.equal(hmac('k', 'a'), hmac('k', 'a'));
  assert.notEqual(hmac('k', 'a'), hmac('k2', 'a'));
});

test('safeEqual', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'abcd'));
});

test('package ids and ints are validated', () => {
  assert.equal(needPackage('com.example.app'), 'com.example.app');
  assert.throws(() => needPackage('nodots'), AppError);
  assert.throws(() => needPackage('com.example..app'), AppError);
  assert.equal(needInt('42', 'x'), 42);
  assert.throws(() => needInt('4.2', 'x'), AppError);
  assert.throws(() => needInt(-1, 'x'), AppError);
});

test('config signature verifies, and fails when tampered', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const signed = signPayload(priv, { pins: ['ab'.repeat(32)] });
  assert.ok(verifyPayload(pub, signed));
  const evil = Buffer.from(JSON.stringify({ pins: ['00'.repeat(32)] })).toString('base64');
  assert.ok(!verifyPayload(pub, { payload: evil, sig: signed.sig }));
});
