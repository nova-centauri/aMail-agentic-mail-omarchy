import sanitizeHtml from 'sanitize-html';
import { load as loadHtml } from 'cheerio';

const ALLOWED_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_EMBEDDED_IMAGE_LENGTH = 1_500_000;

const sanitizerOptions = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'details', 'div', 'em', 'figcaption',
    'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small',
    'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'name'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['align', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  // Deliberately no style attributes: even CSS can retrieve external resources
  // through url(), disguise click targets, or create a hostile mail layout.
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLikelyTracker(url, width, height) {
  const dimensionsAreTiny = Number(width) <= 1 && Number(height) <= 1;
  return dimensionsAreTiny || /(?:pixel|track|beacon|open(?:ed)?|spacer|analytics)/i.test(url);
}

export function toSafeHtmlFromText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

export function textSnippet(value, maxLength = 220) {
  const plain = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}

/**
 * Sanitizes a mail body without loading a single remote byte. External images
 * are retained as inert placeholders; they receive a signed proxied URL only
 * when a message is read back through the API.
 */
export function sanitizeEmailHtml(value) {
  const cleaned = sanitizeHtml(String(value || ''), sanitizerOptions);
  const $ = loadHtml(cleaned, null, false);
  let remoteImageCount = 0;
  let trackerCount = 0;

  $('a').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href || !isHttpUrl(href)) return;
    $(anchor).attr('target', '_blank');
    $(anchor).attr('rel', 'noopener noreferrer');
  });

  $('img').each((_, image) => {
    const element = $(image);
    const source = element.attr('src') || '';

    if (isHttpUrl(source)) {
      const tracker = isLikelyTracker(source, element.attr('width'), element.attr('height'));
      remoteImageCount += 1;
      if (tracker) trackerCount += 1;
      element.removeAttr('src');
      element.attr('data-remote-url', source);
      element.attr('data-remote-blocked', tracker ? 'tracker' : 'image');
      element.attr('loading', 'lazy');
      element.attr('referrerpolicy', 'no-referrer');
      if (!element.attr('alt')) element.attr('alt', tracker ? 'Tracking image blocked' : 'Remote image blocked');
      return;
    }

    if (source.toLowerCase().startsWith('cid:')) {
      const cid = source.slice(4).replace(/^<|>$/g, '');
      element.removeAttr('src');
      element.attr('data-cid', cid);
      if (!element.attr('alt')) element.attr('alt', 'Inline image');
      return;
    }

    if (source.startsWith('data:')) {
      if (!ALLOWED_DATA_IMAGE.test(source) || source.length > MAX_EMBEDDED_IMAGE_LENGTH) {
        element.removeAttr('src');
        element.attr('alt', 'Unsafe embedded image removed');
      }
      return;
    }

    element.removeAttr('src');
    if (!element.attr('alt')) element.attr('alt', 'Inline image unavailable');
  });

  return {
    html: $.root().html() || '',
    remoteImageCount,
    trackerCount,
  };
}

export function hydrateRemoteContent(html, { issueToken }) {
  const $ = loadHtml(String(html || ''), null, false);
  let count = 0;
  $('img[data-remote-url]').each((_, image) => {
    const element = $(image);
    // A deliberate "load images" action must never turn known tracking pixels
    // back on. These stay inert even when ordinary remote images are fetched
    // through the privacy relay.
    if (element.attr('data-remote-blocked') === 'tracker') return;
    const source = element.attr('data-remote-url');
    if (!source || !isHttpUrl(source)) {
      element.removeAttr('data-remote-url');
      return;
    }
    element.attr('data-remote-content', `/api/content/remote?token=${encodeURIComponent(issueToken(source))}`);
    count += 1;
  });
  return { html: $.root().html() || '', remoteImageCount: count };
}

function normalizeCid(value) {
  return String(value || '').replace(/^<|>$/g, '').toLowerCase();
}

/**
 * Point cid: images at same-origin attachment URLs. These are IMAP parts, not
 * remote fetches, so they can render as soon as a message is opened.
 */
export function hydrateCidImages(html, attachments = []) {
  const $ = loadHtml(String(html || ''), null, false);
  const byCid = new Map();
  for (const attachment of attachments) {
    const cid = normalizeCid(attachment?.contentId);
    if (cid && attachment.url) byCid.set(cid, attachment);
  }
  $('img[data-cid]').each((_, image) => {
    const element = $(image);
    const attachment = byCid.get(normalizeCid(element.attr('data-cid')));
    if (!attachment?.url) return;
    element.attr('src', attachment.url);
    element.attr('referrerpolicy', 'no-referrer');
  });
  return { html: $.root().html() || '' };
}
