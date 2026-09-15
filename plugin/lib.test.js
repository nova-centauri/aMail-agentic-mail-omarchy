import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recipientsFrom, resolveOpenTarget } from './lib.mjs';

describe('resolveOpenTarget', () => {
  const config = { url: 'https://mail.example.test' };

  it('focuses the inbox when no path is given', () => {
    const result = resolveOpenTarget(config, '');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://mail.example.test');
    assert.equal(result.focus, true);
  });

  it('opens compose without focusing an existing window', () => {
    const result = resolveOpenTarget(config, '/?compose=1');
    assert.equal(result.ok, true);
    assert.match(result.url, /compose=1/);
    assert.equal(result.focus, false);
    assert.equal(result.intent.compose, true);
  });

  it('opens a thread id as a deep link', () => {
    const result = resolveOpenTarget(config, 'abc-123');
    assert.equal(result.focus, false);
    assert.match(result.url, /thread=abc-123/);
  });

  it('turns mailto: into a compose URL', () => {
    const result = resolveOpenTarget(config, 'mailto:maya@studio.example?subject=Hi');
    assert.equal(result.focus, false);
    assert.match(result.url, /compose=1/);
    assert.match(result.url, /maya%40studio.example/);
    assert.equal(result.intent.subject, 'Hi');
  });

  it('fails when aMail is not configured', () => {
    const result = resolveOpenTarget({ url: '' }, '');
    assert.equal(result.ok, false);
    assert.match(result.error, /not configured/);
  });
});

describe('recipientsFrom', () => {
  it('splits comma-separated addresses and objects', () => {
    assert.deepEqual(recipientsFrom('maya@studio.example, avery@ops.example'), [
      { name: '', email: 'maya@studio.example' },
      { name: '', email: 'avery@ops.example' },
    ]);
    assert.deepEqual(recipientsFrom([{ name: 'Maya', email: 'maya@studio.example' }]), [
      { name: 'Maya', email: 'maya@studio.example' },
    ]);
  });
});
