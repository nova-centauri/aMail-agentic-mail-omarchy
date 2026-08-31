import { ValidationError } from '../errors.js';

export const MAX_COMPOSE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_COMPOSE_ATTACHMENT_COUNT = 8;
export const MAX_COMPOSE_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024;

const DANGEROUS_TYPES = new Set([
  'text/html',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/xhtml+xml',
]);

export function asciiFilename(value) {
  const cleaned = String(value || 'attachment').replace(/[\r\n"]/g, '').replace(/[/\\]/g, '_').slice(0, 180);
  return cleaned || 'attachment';
}

export function safeAttachmentType(type) {
  const normalized = String(type || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
  if (DANGEROUS_TYPES.has(normalized)) return 'application/octet-stream';
  return normalized || 'application/octet-stream';
}

function decodeBase64Content(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  if (!raw) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw) || raw.length % 4 !== 0) return null;
  try {
    const buffer = Buffer.from(raw, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

export function publicAttachmentMeta(attachment, index = 0) {
  return {
    index: Number.isInteger(attachment?.index) ? attachment.index : index,
    filename: asciiFilename(attachment?.filename || attachment?.name),
    contentType: safeAttachmentType(attachment?.contentType || attachment?.type),
    size: Number(attachment?.size) || 0,
    contentId: attachment?.contentId || attachment?.cid || null,
  };
}

export function normalizeComposeAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Attachments must be an array.');
  if (raw.length > MAX_COMPOSE_ATTACHMENT_COUNT) {
    throw new ValidationError(`Attach at most ${MAX_COMPOSE_ATTACHMENT_COUNT} files.`);
  }
  let total = 0;
  return raw.map((item, index) => {
    const filename = asciiFilename(item?.filename || item?.name);
    const contentType = safeAttachmentType(item?.contentType || item?.type);
    const buffer = decodeBase64Content(item?.content || item?.data);
    if (!buffer) throw new ValidationError(`Attachment ${index + 1} is missing file bytes.`);
    if (buffer.length > MAX_COMPOSE_ATTACHMENT_BYTES) {
      throw new ValidationError(`${filename} is larger than 8 MB.`);
    }
    total += buffer.length;
    if (total > MAX_COMPOSE_ATTACHMENT_TOTAL_BYTES) {
      throw new ValidationError('Attached files together must stay under 8 MB.');
    }
    return {
      index,
      filename,
      contentType,
      size: buffer.length,
      content: buffer.toString('base64'),
    };
  });
}

export function mailerAttachments(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    content: Buffer.from(attachment.content, 'base64'),
    contentDisposition: 'attachment',
  }));
}

export function storedAttachmentRecords(attachments = []) {
  return attachments.map((attachment, index) => ({
    index,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    content: attachment.content,
  }));
}

export function attachmentContentBuffer(attachment) {
  if (!attachment?.content) return null;
  try {
    const buffer = Buffer.from(String(attachment.content), 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}
