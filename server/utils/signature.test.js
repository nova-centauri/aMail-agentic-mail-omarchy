import assert from 'node:assert/strict';
import test from 'node:test';
import { appendSignature } from './mail.js';
import {
  extractHtmlDocumentBody,
  looksLikeHtml,
  normalizeStoredSignature,
  renderSignatureForSend,
  sanitizeComposeHtml,
  sanitizeSignatureHtml,
  signatureToPlainText,
} from './signature.js';

test('plain-text signatures stay escaped and keep the RFC delimiter', () => {
  const signed = appendSignature({
    html: '<p>Hello</p>',
    text: 'Hello',
    signature: 'Best,\nNova <Centauri>',
  });
  assert.match(signed.html, /data-amail-signature="true"/);
  assert.match(signed.html, /-- <br>Best,<br>Nova &lt;Centauri&gt;/);
  assert.equal(signed.text, 'Hello\n\n-- \nBest,\nNova <Centauri>');
});

test('HTML signatures keep formatting and drop scripts', () => {
  const signed = appendSignature({
    html: '<p>Hello</p>',
    text: 'Hello',
    signature: '<div><strong>Nova</strong><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="https://centauri.dev/logo.png" alt="Logo"></div>',
  });
  assert.match(signed.html, /<strong>Nova<\/strong>/);
  assert.match(signed.html, /src="https:\/\/centauri.dev\/logo.png"/);
  assert.doesNotMatch(signed.html, /<script/i);
  assert.doesNotMatch(signed.html, /javascript:/i);
  assert.match(signed.text, /Nova/);
  assert.doesNotMatch(signed.html, /-- <br>/);
});

test('uploaded documents use the body and reject oversized signatures', () => {
  const body = extractHtmlDocumentBody('<!doctype html><html><body><p style="color:#0b57d0">Studio</p></body></html>');
  assert.match(body, /Studio/);
  const stored = normalizeStoredSignature(`<p onclick="alert(1)" style="color:#0b57d0;background:url(https://evil.test/x)">Studio</p>`);
  assert.match(stored, /Studio/);
  assert.doesNotMatch(stored, /onclick/);
  assert.doesNotMatch(stored, /url\(/);
  assert.equal(looksLikeHtml('Best,\nNova'), false);
  assert.equal(looksLikeHtml('Nova <Centauri>'), false);
  assert.equal(looksLikeHtml('<p>Best</p>'), true);
  assert.throws(() => normalizeStoredSignature(`<p>${'x'.repeat(200_010)}</p>`), { code: 'VALIDATION_ERROR' });
});

test('HTML signatures convert to readable plain text for the text part', () => {
  const text = signatureToPlainText('<div>Nova<br>Centauri Labs</div>');
  assert.match(text, /Nova/);
  assert.match(text, /Centauri Labs/);
  const rendered = renderSignatureForSend('Kind regards,');
  assert.match(rendered.html, /-- <br>Kind regards,/);
  assert.equal(rendered.text, 'Kind regards,');
});

test('includeSignature=false and empty signatures leave the body unchanged', () => {
  assert.deepEqual(appendSignature({ html: '<p>Hi</p>', text: 'Hi', signature: '  ', includeSignature: true }), {
    html: '<p>Hi</p>',
    text: 'Hi',
  });
  assert.deepEqual(appendSignature({ html: '<p>Hi</p>', text: 'Hi', signature: 'Nova', includeSignature: false }), {
    html: '<p>Hi</p>',
    text: 'Hi',
  });
});

test('sanitizeSignatureHtml keeps tables used by exported email signatures', () => {
  const html = sanitizeSignatureHtml('<table width="420"><tr><td align="left"><font color="#202124">Nova</font></td></tr></table>');
  assert.match(html, /<table/i);
  assert.match(html, /Nova/);
});

test('sanitizeComposeHtml strips scripts from outbound message bodies', () => {
  const html = sanitizeComposeHtml('<p>Hello<script>alert(1)</script></p><a href="javascript:alert(1)">x</a>');
  assert.match(html, /Hello/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /javascript:/i);
});
