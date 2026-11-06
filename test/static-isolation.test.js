'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openHtml } = require('../lib/page');

test('two static pages keep separate engine state', async () => {
  const first = openHtml('<main><button id="a">Alpha</button></main>', 'https://a.test/');
  const second = openHtml('<main><button id="b">Beta</button></main>', 'https://b.test/');

  assert.match(first.api.snapshot({ format: 'text' }), /Alpha/);
  assert.doesNotMatch(first.api.snapshot({ format: 'text' }), /Beta/);
  assert.match(second.api.snapshot({ format: 'text' }), /Beta/);
  assert.doesNotMatch(second.api.snapshot({ format: 'text' }), /Alpha/);

  const target = first.api.snapshot({ format: 'json' }).actions.find((action) => action.label === 'Alpha');
  const result = await first.api.act(target.id, {}, { quiet: 0, minWait: 0 });
  assert.equal(result.status, 'ok');

  assert.match(first.api.snapshot({ format: 'text' }), /Alpha/);
  assert.match(second.api.snapshot({ format: 'text' }), /Beta/);
});
