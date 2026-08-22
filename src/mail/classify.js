import { CATEGORY_ALIASES, SMART_CATEGORIES } from './constants.js';
import { normalizePerson } from './people.js';

export function canonicalCategory(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return CATEGORY_ALIASES[normalized] || CATEGORY_ALIASES[normalized.replace(/_/g, '-')] || null;
}

export function inferSmartCategory(raw = {}) {
  const labels = Array.isArray(raw.labels) ? raw.labels : Array.isArray(raw.tags) ? raw.tags : [];
  const from = normalizePerson(raw.from || raw.sender || raw.fromAddress);
  const haystack = [raw.subject, raw.snippet, raw.preview, from.name, from.email, ...labels].filter(Boolean).join(' ').toLowerCase();
  const isOpsSource = /\b(?:workboard|proxmox|\bpve\b|watchtower|xer0|msl)\b/i.test(haystack)
    || (/\bbackup\b/i.test(haystack) && /\b(?:xer0|msl)\b/i.test(haystack));
  const isOpsError = /\b(?:error|errors|failed|failure|fatal|critical|exception|unreachable|timeout|timed out)\b/i.test(haystack)
    && !/\b(?:0|no|without|zero)\s+errors?\b/i.test(haystack);
  if (isOpsSource) {
    return isOpsError
      ? { category: 'ops_error', reason: 'Matched a Workboard, Proxmox, Watchtower, or xer0/msl backup failure.' }
      : { category: 'ops_quiet', reason: 'Routine ops digest with no error signal (hidden from All mail).' };
  }
  if (/(github|github actions|actions@github|workflow|pull request|check run|build #|ci failed|ci passed)/i.test(haystack)) {
    return { category: 'github_ci', reason: 'Matched GitHub, workflow, pull-request, or CI language.' };
  }
  if (/(status@|status page|incident|degraded|outage|uptime|service health|all systems|resolved:|investigating|monitoring:)/i.test(haystack)) {
    return { category: 'status', reason: 'Matched service-health or incident-update language.' };
  }
  if (/(logs?@|server logs?|cron|nightly backup|backup completed|telemetry|automated digest|job output|stack trace|exception report)/i.test(haystack)) {
    return { category: 'logs', reason: 'Matched automated log, backup, telemetry, or job-output language.' };
  }
  return { category: 'primary', reason: 'Kept in Primary because it looks like regular correspondence.' };
}

function categoryDefinition(category) {
  return SMART_CATEGORIES.find((item) => item.id === category)
    || (category === 'ops_quiet' ? { id: 'ops_quiet', label: 'Ops digests' } : null)
    || SMART_CATEGORIES[1];
}

/**
 * Live API mail already has a server category. Trust that field when present so
 * the client does not re-classify and drift. Inference is only a fallback for
 * preview/demo threads that omit category metadata.
 */
export function smartCategoryMetadata(raw = {}, fallback = {}) {
  const explicit = canonicalCategory(raw.category || raw.smartCategory || raw.categoryId || fallback.category);
  const inferred = explicit ? null : inferSmartCategory({ ...fallback, ...raw });
  const category = explicit || inferred.category;
  const definition = categoryDefinition(category);
  return {
    category: definition.id,
    categoryLabel: raw.categoryLabel || raw.category_label || fallback.categoryLabel || definition.label,
    categoryReason: raw.categoryReason || raw.category_reason || fallback.categoryReason || inferred?.reason || 'No automated category signal matched.',
  };
}
