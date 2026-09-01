const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeLinkHref(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatLink(href, label) {
  if (!isSafeLinkHref(href)) return escapeHtml(label || href);
  return `<a href="${escapeHtml(href)}">${escapeHtml(label || href)}</a>`;
}

function linkifyParagraph(text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)|(https?:\/\/[^\s<]+|mailto:[^\s<]+|tel:[^\s<]+)/gi;
  const value = String(text || '');
  let html = '';
  let lastIndex = 0;
  let match = pattern.exec(value);
  while (match) {
    html += escapeHtml(value.slice(lastIndex, match.index));
    if (match[1] && match[2]) {
      html += formatLink(match[2], match[1]);
    } else {
      const href = match[3];
      const cleaned = href.replace(/[),.;:]+$/, '');
      const trailing = href.slice(cleaned.length);
      html += `${formatLink(cleaned, cleaned)}${escapeHtml(trailing)}`;
    }
    lastIndex = match.index + match[0].length;
    match = pattern.exec(value);
  }
  return html + escapeHtml(value.slice(lastIndex));
}

export function insertMarkdownLink(body, { start, end, href, label }) {
  const text = String(body || '');
  const from = Math.max(0, Number(start) || 0);
  const to = Math.max(from, Number(end) || from);
  const selected = text.slice(from, to);
  const linkLabel = String(label || selected || href || '').trim() || href;
  const snippet = `[${linkLabel}](${href})`;
  return {
    body: `${text.slice(0, from)}${snippet}${text.slice(to)}`,
    selectionStart: from,
    selectionEnd: from + snippet.length,
  };
}

export function plainTextToHtml(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${linkifyParagraph(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function quotedComposeHtml({ date, sender, subject, html, text, mode = 'reply' } = {}) {
  const inner = html ? String(html) : plainTextToHtml(text || '');
  const when = escapeHtml(date || '');
  const who = escapeHtml(sender || 'the sender');
  if (mode === 'forward') {
    return `<div><br></div><div>---------- Forwarded message ----------</div><div>From: ${who}</div><div>Date: ${when}</div><div>Subject: ${escapeHtml(subject || '(no subject)')}</div><div><br></div>${inner}`;
  }
  return `<div><br></div><div>On ${when}, ${who} wrote:</div><blockquote>${inner}</blockquote>`;
}

export function sanitizeEmailHtml(html, allowRemoteContent = false) {
  if (!html || typeof window === 'undefined' || typeof DOMParser === 'undefined') return '';
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(html), 'text/html');
  documentNode.querySelectorAll('script, style, link, meta, base, form, iframe, object, embed, video, audio, svg, math').forEach((element) => element.remove());
  documentNode.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'poster' || name === 'background') element.removeAttribute(attribute.name);
    });
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      try {
        const parsed = new URL(href, window.location.href);
        if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) element.removeAttribute('href');
        else {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      } catch {
        element.removeAttribute('href');
      }
    }
    if (element.tagName === 'IMG') {
      const privateRemotePath = element.getAttribute('data-remote-content') || '';
      if (privateRemotePath) {
        try {
          const remoteUrl = new URL(privateRemotePath, window.location.href);
          const isIssuedRemotePath = remoteUrl.origin === window.location.origin && remoteUrl.pathname === '/api/content/remote';
          const isTracker = element.getAttribute('data-remote-blocked') === 'tracker';
          if (allowRemoteContent && isIssuedRemotePath && !isTracker) {
            element.setAttribute('src', `${remoteUrl.pathname}${remoteUrl.search}`);
            element.setAttribute('referrerpolicy', 'no-referrer');
          } else {
            element.removeAttribute('src');
            element.setAttribute('alt', element.getAttribute('alt') || (isTracker ? 'Tracking image blocked' : 'Remote image blocked'));
            element.classList.add('blocked-email-image');
          }
          return;
        } catch {
          element.removeAttribute('data-remote-content');
        }
      }
      const src = element.getAttribute('src') || '';
      if (/^cid:/i.test(src)) {
        element.setAttribute('data-cid', src.replace(/^cid:/i, ''));
        element.removeAttribute('src');
        element.setAttribute('alt', element.getAttribute('alt') || 'Inline image');
        element.classList.add('blocked-email-image');
        return;
      }
      try {
        const parsed = new URL(src, window.location.href);
        const localImage = parsed.origin === window.location.origin && parsed.protocol !== 'data:';
        const issuedAttachment = localImage && parsed.pathname === '/api/content/attachment';
        const issuedRemote = localImage && parsed.pathname === '/api/content/remote';
        const safeDataImage = /^data:image\/(png|gif|jpe?g|webp);/i.test(src);
        if (issuedAttachment || issuedRemote || localImage || safeDataImage) return;
        element.removeAttribute('src');
        element.setAttribute('alt', element.getAttribute('alt') || 'Remote image blocked');
        element.classList.add('blocked-email-image');
      } catch {
        element.removeAttribute('src');
      }
    }
  });
  return documentNode.body.innerHTML;
}
