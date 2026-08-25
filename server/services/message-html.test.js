import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateCidImages, hydrateRemoteContent, sanitizeEmailHtml, toSafeHtmlFromText } from './message-html.js';

test('external mail content is inert by default and known trackers never get a relay URL', () => {
  const source = [
    '<script>window.pwned = true</script>',
    '<img src="https://pixels.example/open" width="1" height="1">',
    '<img src="https://cdn.example/logo.png" alt="Logo">',
    '<a href="https://example.test/path" onclick="alert(1)">Open</a>',
  ].join('');

  const sanitized = sanitizeEmailHtml(source);
  assert.equal(sanitized.remoteImageCount, 2);
  assert.equal(sanitized.trackerCount, 1);
  assert.doesNotMatch(sanitized.html, /<script/i);
  assert.doesNotMatch(sanitized.html, /onclick=/i);
  assert.match(sanitized.html, /data-remote-blocked="tracker"/);
  assert.match(sanitized.html, /data-remote-blocked="image"/);

  const issuedFor = [];
  const hydrated = hydrateRemoteContent(sanitized.html, {
    issueToken: (url) => {
      issuedFor.push(url);
      return `signed:${issuedFor.length}`;
    },
  });
  assert.deepEqual(issuedFor, ['https://cdn.example/logo.png']);
  assert.equal(hydrated.remoteImageCount, 1);
  assert.match(hydrated.html, /data-remote-content="\/api\/content\/remote\?token=signed%3A1"/);
  assert.doesNotMatch(hydrated.html, /token=.*pixels/i);
});

test('cid images stay inert until mapped to a same-origin attachment URL', () => {
  const sanitized = sanitizeEmailHtml('<img src="cid:logo@example" alt="Logo">');
  assert.doesNotMatch(sanitized.html, /src="cid:/i);
  assert.match(sanitized.html, /data-cid="logo@example"/);

  const hydrated = hydrateCidImages(sanitized.html, [{
    contentId: 'logo@example',
    url: '/api/content/attachment?token=signed',
  }]);
  assert.match(hydrated.html, /src="\/api\/content\/attachment\?token=signed"/);
});

test('plain-text mail is safely escaped before it reaches an HTML reader', () => {
  const html = toSafeHtmlFromText('<img src=x onerror=alert(1)>\nHello & goodbye');
  assert.match(html, /&lt;img/);
  assert.match(html, /Hello &amp; goodbye/);
  assert.match(html, /<br>/);
});
