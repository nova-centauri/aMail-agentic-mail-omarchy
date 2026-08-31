import { describe, expect, it } from 'vitest';
import {
  editorHtmlToStored,
  extractHtmlDocumentBody,
  looksLikeHtml,
  sanitizeSignatureHtml,
  storedSignatureToEditorHtml,
  validateSignatureLength,
} from './signature.js';

describe('signature helpers', () => {
  it('detects HTML tags without treating comparisons as markup', () => {
    expect(looksLikeHtml('<p>Best</p>')).toBe(true);
    expect(looksLikeHtml('Best,\nNova')).toBe(false);
    expect(looksLikeHtml('Price < 100')).toBe(false);
    expect(looksLikeHtml('Nova <Centauri>')).toBe(false);
  });

  it('extracts the body from a full HTML document', () => {
    const html = extractHtmlDocumentBody('<!doctype html><html><head><title>Sig</title></head><body><strong>Nova</strong></body></html>');
    expect(html).toContain('Nova');
    expect(html).not.toContain('<title>');
  });

  it('strips scripts, handlers, and unsafe CSS while keeping signature formatting', () => {
    const html = sanitizeSignatureHtml([
      '<div style="color:#0b57d0;background:url(https://evil.test/x.png)">',
      '<strong onclick="alert(1)">Nova</strong>',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://centauri.dev">site</a>',
      '<img src="https://centauri.dev/logo.png" alt="Logo">',
      '</div>',
    ].join(''));
    expect(html).toContain('Nova');
    expect(html).toContain('https://centauri.dev');
    expect(html).toContain('logo.png');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it('converts stored plain text for the visual editor and back', () => {
    expect(storedSignatureToEditorHtml('Best,\nNova')).toBe('Best,<br>Nova');
    expect(editorHtmlToStored('<div>Best,<br>Nova</div>')).toContain('Best');
    expect(editorHtmlToStored('<div><br></div>')).toBe('');
  });

  it('rejects signatures over the stored length cap', () => {
    expect(validateSignatureLength('short')).toBe('');
    expect(validateSignatureLength('x'.repeat(200_001))).toMatch(/too long/i);
  });
});
