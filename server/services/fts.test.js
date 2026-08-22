import assert from 'node:assert/strict';
import test from 'node:test';
import { toFtsMatchQuery } from './fts.js';

test('FTS queries are tokenized and never pass raw operators', () => {
  assert.equal(toFtsMatchQuery(''), '');
  assert.equal(toFtsMatchQuery('   '), '');
  assert.equal(toFtsMatchQuery('Workflow failed'), '"workflow"* AND "failed"*');
  assert.equal(toFtsMatchQuery('phil@midstatelitho.com'), '"phil@midstatelitho.com"*');
  assert.equal(toFtsMatchQuery('hello "OR" world'), '"hello"* AND "or"* AND "world"*');
  assert.equal(toFtsMatchQuery('!!!'), '');
});
