// Deep links for the aMail web client. The Omarchy plugin, mailto handlers,
// and the desktop web app all land here so compose / open-thread actually
// happen instead of dropping the user on an empty inbox.
//
// Supported:
//   ?compose=1[&to=&cc=&bcc=&subject=&body=]
//   ?thread=<id>
//   ?thread=<id>&reply=1|&replyAll=1|&forward=1
//   ?reply=<id>  ?forward=<id>
//   #compose  #thread/<id>  #reply/<id>  #reply-all/<id>  #forward/<id>
//   mailto:addr?subject=&body=&cc=&bcc=

const QUERY_KEYS = ['compose', 'to', 'cc', 'bcc', 'subject', 'body', 'thread', 'reply', 'replyAll', 'forward'];

function decodePlus(value) {
  return String(value || '').replace(/\+/g, ' ');
}

function firstHeader(params, name) {
  const raw = params.get(name);
  return raw == null ? '' : decodePlus(raw);
}

function truthy(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

export function parseMailto(value) {
  const raw = String(value || '').trim();
  if (!/^mailto:/i.test(raw)) return null;
  const rest = raw.slice(raw.indexOf(':') + 1);
  const q = rest.indexOf('?');
  const addrPart = decodeURIComponent((q < 0 ? rest : rest.slice(0, q)).replace(/\+/g, '%20')).replace(/^\/\//, '');
  const query = q < 0 ? '' : rest.slice(q + 1);
  const params = new URLSearchParams(query);
  const extraTo = firstHeader(params, 'to');
  const to = [addrPart, extraTo].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  return {
    compose: true,
    to,
    cc: firstHeader(params, 'cc'),
    bcc: firstHeader(params, 'bcc'),
    subject: firstHeader(params, 'subject'),
    body: firstHeader(params, 'body'),
  };
}

function parseHash(hash) {
  const text = String(hash || '').replace(/^#/, '').trim();
  if (!text) return {};
  if (text === 'compose' || text.startsWith('compose?') || text.startsWith('compose&')) {
    const q = text.indexOf('?') >= 0 ? text.slice(text.indexOf('?') + 1)
      : text.startsWith('compose&') ? text.slice('compose&'.length)
        : '';
    const params = new URLSearchParams(q);
    return {
      compose: true,
      to: firstHeader(params, 'to'),
      cc: firstHeader(params, 'cc'),
      bcc: firstHeader(params, 'bcc'),
      subject: firstHeader(params, 'subject'),
      body: firstHeader(params, 'body'),
    };
  }
  const thread = text.match(/^thread\/([^/?#]+)/i);
  if (thread) return { thread: decodeURIComponent(thread[1]) };
  const replyAll = text.match(/^reply-all\/([^/?#]+)/i);
  if (replyAll) return { thread: decodeURIComponent(replyAll[1]), reply: true, replyAll: true };
  const reply = text.match(/^reply\/([^/?#]+)/i);
  if (reply) return { thread: decodeURIComponent(reply[1]), reply: true };
  const forward = text.match(/^forward\/([^/?#]+)/i);
  if (forward) return { thread: decodeURIComponent(forward[1]), forward: true };
  return {};
}

function hasIntent(intent) {
  if (!intent) return false;
  return Boolean(
    intent.compose
    || intent.thread
    || intent.reply
    || intent.forward
    || intent.to
    || intent.cc
    || intent.bcc
    || intent.subject
    || intent.body,
  );
}

export function parseMailDeepLink(href) {
  const raw = String(href || '').trim();
  if (!raw) return null;
  if (/^mailto:/i.test(raw)) {
    const mailto = parseMailto(raw);
    return hasIntent(mailto) ? mailto : null;
  }
  let url;
  try {
    url = new URL(raw, 'http://amail.invalid');
  } catch {
    return null;
  }
  const params = url.searchParams;
  const fromHash = parseHash(url.hash);
  const threadParam = params.get('thread') || '';
  const replyParam = params.get('reply');
  const forwardParam = params.get('forward');
  const replyAll = truthy(params.get('replyAll')) || Boolean(fromHash.replyAll);
  const intent = {
    compose: truthy(params.get('compose')) || Boolean(fromHash.compose) || Boolean(params.get('to') || params.get('subject') || params.get('body')),
    to: params.get('to') || fromHash.to || '',
    cc: params.get('cc') || fromHash.cc || '',
    bcc: params.get('bcc') || fromHash.bcc || '',
    subject: params.get('subject') || fromHash.subject || '',
    body: params.get('body') || fromHash.body || '',
    thread: threadParam || fromHash.thread || '',
    reply: truthy(replyParam) || Boolean(fromHash.reply) || (replyParam && !truthy(replyParam) ? replyParam : ''),
    replyAll,
    forward: truthy(forwardParam) || Boolean(fromHash.forward) || (forwardParam && !truthy(forwardParam) ? forwardParam : ''),
  };
  if (intent.reply && intent.reply !== true && !intent.thread) intent.thread = String(intent.reply);
  if (intent.forward && intent.forward !== true && !intent.thread) intent.thread = String(intent.forward);
  intent.reply = Boolean(intent.reply) || replyAll;
  intent.forward = Boolean(intent.forward);
  if (intent.reply || intent.forward) intent.compose = true;
  return hasIntent(intent) ? intent : null;
}

export function buildMailDeepLink(base, intent = {}) {
  const url = new URL(String(base || 'http://amail.invalid'));
  if (intent.compose || intent.to || intent.cc || intent.bcc || intent.subject || intent.body || intent.reply || intent.forward) {
    url.searchParams.set('compose', '1');
  }
  for (const key of ['to', 'cc', 'bcc', 'subject', 'body', 'thread']) {
    const value = intent[key];
    if (value) url.searchParams.set(key, String(value));
  }
  if (intent.reply && intent.thread) url.searchParams.set('reply', '1');
  else if (intent.reply && intent.reply !== true) url.searchParams.set('reply', String(intent.reply));
  else if (intent.reply) url.searchParams.set('reply', '1');
  if (intent.replyAll) url.searchParams.set('replyAll', '1');
  if (intent.forward && intent.thread) url.searchParams.set('forward', '1');
  else if (intent.forward && intent.forward !== true) url.searchParams.set('forward', String(intent.forward));
  else if (intent.forward) url.searchParams.set('forward', '1');
  url.hash = '';
  return url.toString();
}

export function stripMailDeepLink(href) {
  const raw = String(href || '').trim();
  if (!raw || /^mailto:/i.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw, 'http://amail.invalid');
  } catch {
    return raw;
  }
  for (const key of QUERY_KEYS) url.searchParams.delete(key);
  if (/^(compose|thread\/|reply\/|reply-all\/|forward\/)/i.test(url.hash.replace(/^#/, ''))) url.hash = '';
  return `${url.pathname}${url.search}${url.hash}` || '/';
}

export { QUERY_KEYS as MAIL_DEEP_LINK_KEYS };
