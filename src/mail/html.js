export function plainTextToHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  return escaped.split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
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
