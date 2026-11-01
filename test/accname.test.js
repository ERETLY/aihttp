'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAccessibleName } = require('dom-accessibility-api');
const { loadHtml } = require('../benchmark/lib/harness');

const HTML = '<!doctype html><html><body><main>' +
  '<button id="b1" aria-label="Close dialog">X</button>' +
  '<span id="lbl">Account number</span><input id="i1" aria-labelledby="lbl">' +
  '<label for="i2">Email</label><input id="i2">' +
  '<input id="i3" placeholder="Search">' +
  '<button id="b2" title="Print page"><svg><title>Print page</title></svg></button>' +
  '<button id="b3"><img alt="Save"></button>' +
  '</main></body></html>';

test('common accessible names match dom-accessibility-api', () => {
  const { ahttp, document } = loadHtml(HTML, 'https://accname.test/');
  const snapshot = ahttp.snapshot({ format: 'json', maxActions: 40 });
  const ids = ['b1', 'i1', 'i2', 'b2', 'b3'];
  const labels = snapshot.actions.map((action) => action.label);
  for (const id of ids) {
    const element = document.getElementById(id);
    const expected = computeAccessibleName(element).replace(/\s+/g, ' ').trim();
    assert.ok(expected, id + ' has an expected accessible name');
    assert.ok(labels.indexOf(expected) >= 0, id + ' label "' + expected + '" appears in ' + JSON.stringify(labels));
  }
  const placeholder = document.getElementById('i3');
  assert.equal(computeAccessibleName(placeholder), '', 'the reference algorithm does not use placeholder as a name');
  assert.ok(labels.indexOf('Search') >= 0, 'ahttp uses placeholder as a practical fallback label');
});
