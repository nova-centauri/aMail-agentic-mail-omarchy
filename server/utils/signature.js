import { load as loadHtml } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { ValidationError } from '../errors.js';

export const SIGNATURE_MAX_LENGTH = 200_000;
export const SIGNATURE_EMBEDDED_IMAGE_MAX_LENGTH = 180_000;

const HTML_TAG = /<\/?(?:html|head|body|a|abbr|b|blockquote|br|caption|center|code|div|em|figcaption|figure|font|h[1-6]|hr|i|img|li|ol|p|pre|s|small|span|strong|sub|sup|table|tbody|td|tfoot|th|thead|tr|u|ul)\b[^>]*>/i;
const allowedStyleValue = /^(?!.*(?:url\s*\(|expression\s*\(|javascript:|@import|-moz-binding)).{1,240}$/i;
const sizeValue = /^(?:auto|0|[-+]?\d*\.?\d+(?:px|em|rem|%|pt|ex|ch|vw|vh)?)$/i;
const colorValue = /^(?:transparent|currentcolor|inherit|[a-z]{3,20}|#(?:[0-9a-f]{3,8})|rgba?\(\s*[\d.%,\s]+\s*\)|hsla?\(\s*[\d.%,\s]+\s*\))$/i;

const sanitizerOptions = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'div', 'em',
    'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
    'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'name', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height', 'border'],
    font: ['color', 'face', 'size'],
    table: ['width', 'height', 'align', 'border', 'cellpadding', 'cellspacing', 'bgcolor'],
    td: ['width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor'],
    th: ['width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor'],
    '*': ['style', 'align', 'dir', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
    a: ['http', 'https', 'mailto', 'tel'],
  },
  allowedStyles: {
    '*': {
      color: [colorValue],
      'background-color': [colorValue],
      'font-size': [sizeValue],
      'font-family': [allowedStyleValue],
      'font-weight': [allowedStyleValue],
      'font-style': [allowedStyleValue],
      'text-align': [/^(?:left|right|center|justify|start|end)$/i],
      'text-decoration': [allowedStyleValue],
      'line-height': [sizeValue],
      'letter-spacing': [sizeValue],
      width: [sizeValue],
      height: [sizeValue],
      'max-width': [sizeValue],
      'min-width': [sizeValue],
      margin: [allowedStyleValue],
      'margin-top': [sizeValue],
      'margin-right': [sizeValue],
      'margin-bottom': [sizeValue],
      'margin-left': [sizeValue],
      padding: [allowedStyleValue],
      'padding-top': [sizeValue],
      'padding-right': [sizeValue],
      'padding-bottom': [sizeValue],
      'padding-left': [sizeValue],
      border: [allowedStyleValue],
      'border-top': [allowedStyleValue],
      'border-right': [allowedStyleValue],
      'border-bottom': [allowedStyleValue],
      'border-left': [allowedStyleValue],
      'border-width': [allowedStyleValue],
      'border-style': [allowedStyleValue],
      'border-color': [colorValue],
      'border-radius': [allowedStyleValue],
      'border-collapse': [/^(?:collapse|separate)$/i],
      'vertical-align': [allowedStyleValue],
      'white-space': [/^(?:normal|nowrap|pre-line|pre-wrap)$/i],
      display: [/^(?:inline|inline-block|block|none|table|table-cell|table-row)$/i],
    },
  },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  exclusiveFilter(frame) {
    if (frame.tag !== 'img') return false;
    const src = String(frame.attribs?.src || '');
    if (src.startsWith('data:')) {
      return !/^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(src)
        || src.length > SIGNATURE_EMBEDDED_IMAGE_MAX_LENGTH;
    }
    return false;
  },
};

export function looksLikeHtml(value) {
  return HTML_TAG.test(String(value || ''));
}

export function extractHtmlDocumentBody(raw) {
  const source = String(raw || '').replace(/^\uFEFF/, '');
  if (!source.trim()) return '';
  if (!/<html[\s>]|<body[\s>]/i.test(source)) return source.trim();
  const $ = loadHtml(source);
  const body = $('body');
  return String(body.length ? body.html() ?? '' : source).trim();
}

export function sanitizeSignatureHtml(value) {
  return sanitizeHtml(String(value || ''), sanitizerOptions).trim();
}

export function signatureToPlainText(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (!looksLikeHtml(raw)) return raw.replace(/\r\n/g, '\n').trim();
  const $ = loadHtml(sanitizeSignatureHtml(raw) || raw, null, false);
  $('br').replaceWith('\n');
  $('p, div, tr, h1, h2, h3, h4, h5, h6, li, blockquote').append('\n');
  const text = ($('body').length ? $('body').text() : $.root().text())
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

export function normalizeStoredSignature(value) {
  const raw = String(value ?? '').replace(/^\uFEFF/, '');
  if (!raw.trim()) return '';
  const prepared = looksLikeHtml(raw)
    ? sanitizeSignatureHtml(extractHtmlDocumentBody(raw))
    : raw.replace(/\r\n/g, '\n');
  if (prepared.length > SIGNATURE_MAX_LENGTH) {
    throw new ValidationError(`Signature must be ${SIGNATURE_MAX_LENGTH.toLocaleString()} characters or fewer.`);
  }
  return prepared;
}

export function renderSignatureForSend(signature) {
  const raw = String(signature || '').trim();
  if (!raw) return { html: '', text: '' };
  if (looksLikeHtml(raw)) {
    const html = sanitizeSignatureHtml(extractHtmlDocumentBody(raw));
    return { html, text: signatureToPlainText(html || raw) };
  }
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  return {
    html: `-- <br>${escaped}`,
    text: raw,
  };
}
