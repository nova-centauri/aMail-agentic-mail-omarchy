import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeComposeAttachments } from './compose-attachments.js';

test('compose attachments accept base64 bytes and reject oversize payloads', () => {
  const content = Buffer.from('hello notes').toString('base64');
  const [attachment] = normalizeComposeAttachments([
    { filename: 'notes.txt', contentType: 'text/plain', content },
  ]);
  assert.equal(attachment.filename, 'notes.txt');
  assert.equal(attachment.size, 11);
  assert.equal(attachment.contentType, 'text/plain');

  assert.throws(
    () => normalizeComposeAttachments([{ filename: 'empty.txt', content: '' }]),
    /missing file bytes/i,
  );
  assert.throws(
    () => normalizeComposeAttachments(Array.from({ length: 9 }, (_, index) => ({
      filename: `file-${index}.txt`,
      content,
    }))),
    /at most 8/i,
  );
});

test('dangerous compose attachment types are stored as octet-stream', () => {
  const content = Buffer.from('<svg></svg>').toString('base64');
  const [attachment] = normalizeComposeAttachments([
    { filename: 'image.svg', contentType: 'image/svg+xml', content },
  ]);
  assert.equal(attachment.contentType, 'application/octet-stream');
});
