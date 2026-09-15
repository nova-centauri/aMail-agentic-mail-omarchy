import { describe, expect, it } from 'vitest';
import { buildMailDeepLink, parseMailDeepLink, parseMailto, stripMailDeepLink } from './deep-link.js';

describe('parseMailto', () => {
  it('reads an address and RFC 6068 headers', () => {
    expect(parseMailto('mailto:maya@studio.example?subject=Hello%20there&body=Can%20we%20talk%3F&cc=avery@ops.example')).toEqual({
      compose: true,
      to: 'maya@studio.example',
      cc: 'avery@ops.example',
      bcc: '',
      subject: 'Hello there',
      body: 'Can we talk?',
    });
  });

  it('joins extra to= headers with the path addresses', () => {
    expect(parseMailto('mailto:maya@studio.example?to=jordan@studio.example').to).toBe('maya@studio.example, jordan@studio.example');
  });

  it('returns null for non-mailto values', () => {
    expect(parseMailto('https://mail.example.test/?compose=1')).toBeNull();
  });
});

describe('parseMailDeepLink', () => {
  it('opens compose from ?compose=1 and recipient fields', () => {
    expect(parseMailDeepLink('https://mail.example.test/?compose=1')).toMatchObject({ compose: true });
    expect(parseMailDeepLink('https://mail.example.test/?compose=1&to=maya@studio.example&subject=Hi&body=Hello')).toMatchObject({
      compose: true,
      to: 'maya@studio.example',
      subject: 'Hi',
      body: 'Hello',
    });
  });

  it('opens a thread and reply/forward intents', () => {
    expect(parseMailDeepLink('https://mail.example.test/?thread=abc-123')).toMatchObject({ thread: 'abc-123' });
    expect(parseMailDeepLink('https://mail.example.test/?thread=abc-123&reply=1')).toMatchObject({
      thread: 'abc-123',
      reply: true,
      compose: true,
    });
    expect(parseMailDeepLink('https://mail.example.test/?thread=abc-123&replyAll=1')).toMatchObject({
      thread: 'abc-123',
      reply: true,
      replyAll: true,
      compose: true,
    });
    expect(parseMailDeepLink('https://mail.example.test/?forward=abc-123')).toMatchObject({
      thread: 'abc-123',
      forward: true,
      compose: true,
    });
  });

  it('accepts hash routes used by in-app navigation', () => {
    expect(parseMailDeepLink('https://mail.example.test/#compose')).toMatchObject({ compose: true });
    expect(parseMailDeepLink('https://mail.example.test/#thread/abc-123')).toMatchObject({ thread: 'abc-123' });
    expect(parseMailDeepLink('https://mail.example.test/#reply/abc-123')).toMatchObject({ thread: 'abc-123', reply: true, compose: true });
    expect(parseMailDeepLink('https://mail.example.test/#reply-all/abc-123')).toMatchObject({ thread: 'abc-123', replyAll: true, compose: true });
    expect(parseMailDeepLink('https://mail.example.test/#forward/abc-123')).toMatchObject({ thread: 'abc-123', forward: true, compose: true });
  });

  it('parses a mailto: href as compose', () => {
    expect(parseMailDeepLink('mailto:maya@studio.example?subject=Hi')).toMatchObject({
      compose: true,
      to: 'maya@studio.example',
      subject: 'Hi',
    });
  });

  it('returns null when the URL has no mail intent', () => {
    expect(parseMailDeepLink('https://mail.example.test/')).toBeNull();
    expect(parseMailDeepLink('https://mail.example.test/?folder=inbox')).toBeNull();
  });
});

describe('buildMailDeepLink and stripMailDeepLink', () => {
  it('builds a compose URL the parser understands', () => {
    const href = buildMailDeepLink('https://mail.example.test', {
      compose: true,
      to: 'maya@studio.example',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(href).toContain('compose=1');
    expect(parseMailDeepLink(href)).toMatchObject({
      compose: true,
      to: 'maya@studio.example',
      subject: 'Hi',
      body: 'Hello',
    });
  });

  it('builds a thread-reply URL', () => {
    const href = buildMailDeepLink('https://mail.example.test/', { thread: 'abc-123', reply: true, replyAll: true });
    expect(parseMailDeepLink(href)).toMatchObject({ thread: 'abc-123', reply: true, replyAll: true, compose: true });
  });

  it('strips mail params so a reload does not reopen compose', () => {
    expect(stripMailDeepLink('https://mail.example.test/?compose=1&to=a@b.example&folder=inbox#compose')).toBe('/?folder=inbox');
    expect(stripMailDeepLink('https://mail.example.test/#thread/abc-123')).toBe('/');
  });
});
