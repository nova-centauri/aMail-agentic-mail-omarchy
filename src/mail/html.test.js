import { describe, expect, it } from 'vitest';
import { insertMarkdownLink, isSafeLinkHref, plainTextToHtml, quotedComposeHtml } from './html.js';

describe('plainTextToHtml', () => {
  it('turns markdown and bare URLs into safe anchors', () => {
    const html = plainTextToHtml('See [docs](https://mail.example.test/help) and https://example.com/a.');
    expect(html).toContain('<a href="https://mail.example.test/help">docs</a>');
    expect(html).toContain('<a href="https://example.com/a">https://example.com/a</a>.');
    expect(html).not.toContain('javascript:');
  });

  it('rejects unsafe link targets', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('https://mail.example.test')).toBe(true);
    expect(plainTextToHtml('[x](javascript:alert(1))')).toContain('javascript:alert(1)');
    expect(plainTextToHtml('[x](javascript:alert(1))')).not.toContain('<a ');
  });
});

describe('quotedComposeHtml', () => {
  it('wraps a reply in a blockquote and a forward in a header', () => {
    const reply = quotedComposeHtml({ date: 'Tue, Sep 1', sender: 'Maya Chen', text: 'See you tomorrow.' });
    expect(reply).toContain('On Tue, Sep 1, Maya Chen wrote:');
    expect(reply).toContain('<blockquote>');
    expect(reply).toContain('See you tomorrow.');
    const forward = quotedComposeHtml({
      date: 'Tue, Sep 1',
      sender: 'Maya Chen',
      subject: 'Design sync',
      html: '<p>Ready</p>',
      mode: 'forward',
    });
    expect(forward).toContain('Forwarded message');
    expect(forward).toContain('Design sync');
    expect(forward).toContain('<p>Ready</p>');
  });
});

describe('insertMarkdownLink', () => {
  it('wraps the current selection', () => {
    const next = insertMarkdownLink('See docs here', { start: 4, end: 8, href: 'https://example.com', label: 'docs' });
    expect(next.body).toBe('See [docs](https://example.com) here');
  });
});
