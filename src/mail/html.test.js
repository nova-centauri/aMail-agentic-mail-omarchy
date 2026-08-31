import { describe, expect, it } from 'vitest';
import { insertMarkdownLink, isSafeLinkHref, plainTextToHtml } from './html.js';

describe('plainTextToHtml', () => {
  it('turns markdown and bare URLs into safe anchors', () => {
    const html = plainTextToHtml('See [docs](https://mail.xer0.io/help) and https://example.com/a.');
    expect(html).toContain('<a href="https://mail.xer0.io/help">docs</a>');
    expect(html).toContain('<a href="https://example.com/a">https://example.com/a</a>.');
    expect(html).not.toContain('javascript:');
  });

  it('rejects unsafe link targets', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('https://mail.xer0.io')).toBe(true);
    expect(plainTextToHtml('[x](javascript:alert(1))')).toContain('javascript:alert(1)');
    expect(plainTextToHtml('[x](javascript:alert(1))')).not.toContain('<a ');
  });
});

describe('insertMarkdownLink', () => {
  it('wraps the current selection', () => {
    const next = insertMarkdownLink('See docs here', { start: 4, end: 8, href: 'https://example.com', label: 'docs' });
    expect(next.body).toBe('See [docs](https://example.com) here');
  });
});
