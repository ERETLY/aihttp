'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeText } = require('../lib/page');

const PRIVET_1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
const PRIVET_UTF8 = Buffer.from('Привет', 'utf8');

test('Content-Type charset decodes windows-1251', () => {
  assert.equal(decodeText(PRIVET_1251, { 'content-type': 'text/html; charset=windows-1251' }), 'Привет');
});

test('meta charset decodes windows-1251 when the header is missing', () => {
  const body = Buffer.concat([Buffer.from('<meta charset="windows-1251">'), PRIVET_1251]);
  assert.equal(decodeText(body, {}), '<meta charset="windows-1251">Привет');
});

test('http-equiv meta charset is recognized', () => {
  const body = Buffer.concat([
    Buffer.from('<meta http-equiv="content-type" content="text/html; charset=windows-1251">'),
    PRIVET_1251
  ]);
  assert.equal(decodeText(body, {}), '<meta http-equiv="content-type" content="text/html; charset=windows-1251">Привет');
});

test('UTF-8 without a header still works', () => {
  assert.equal(decodeText(PRIVET_UTF8, {}), 'Привет');
});

test('a UTF-8 BOM is stripped', () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PRIVET_UTF8]);
  assert.equal(decodeText(body, {}), 'Привет');
});

test('the header wins over a conflicting meta charset', () => {
  const body = Buffer.concat([Buffer.from('<meta charset="utf-8">'), PRIVET_1251]);
  assert.equal(decodeText(body, { 'content-type': 'text/html; charset=windows-1251' }), '<meta charset="utf-8">Привет');
});
