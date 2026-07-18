const CATEGORY_DEFINITIONS = [
  ['primary', 'Primary'],
  ['github_ci', 'GitHub & CI'],
  ['logs', 'Logs & alerts'],
  ['status', 'Status updates'],
  // Routine digests for known infra tools. Hidden from the default inbox even
  // when unread; only failures surface as ops_error.
  ['ops_error', 'Ops errors'],
  ['ops_quiet', 'Ops digests'],
];

// Bump when classification rules change so startup reclassifies stored mail.
export const SMART_FILTER_VERSION = 2;

export const SMART_CATEGORIES = Object.freeze(Object.fromEntries(
  CATEGORY_DEFINITIONS.map(([slug, label]) => [slug, Object.freeze({ slug, label })]),
));

export const SMART_CATEGORY_SLUGS = Object.freeze(CATEGORY_DEFINITIONS.map(([slug]) => slug));

/** Categories that never appear in the default "All mail" inbox list. */
export const HIDDEN_DEFAULT_CATEGORIES = Object.freeze(['ops_quiet']);

/**
 * Flagged people folders. Addresses include known typos the operator supplied so
 * real Midstate mail (and common domain misspellings) both match.
 */
export const PERSON_FLAGS = Object.freeze([
  Object.freeze({
    id: 'phil',
    label: 'Phil',
    shortLabel: 'Phil',
    description: 'Mail involving Phil at Midstate Litho',
    emails: Object.freeze([
      'phil@midstatelitho.com',
      'phil@midstaelitho.com',
    ]),
  }),
  Object.freeze({
    id: 'sarah',
    label: 'Sarah',
    shortLabel: 'Sarah',
    description: 'Mail involving Sarah at Midstate Litho',
    emails: Object.freeze([
      'sarah@midstatelitho.com',
    ]),
  }),
  Object.freeze({
    id: 'mark',
    label: 'Mark Culley',
    shortLabel: 'Mark',
    description: 'Mail involving Mark Culley',
    emails: Object.freeze([
      'mark_culley@sdmc.com',
    ]),
  }),
  Object.freeze({
    id: 'support',
    label: 'Midstate Support',
    shortLabel: 'Support',
    description: 'Mail involving Midstate Litho support',
    emails: Object.freeze([
      'support@midstatelitho.com',
      'support@midstaetlitho.com',
    ]),
  }),
  Object.freeze({
    id: 'sales',
    label: 'Midstate Sales',
    shortLabel: 'Sales',
    description: 'Mail involving Midstate Litho sales',
    emails: Object.freeze([
      'sales@midstatelitho.com',
    ]),
  }),
]);

export const PERSON_FLAG_IDS = Object.freeze(PERSON_FLAGS.map((flag) => flag.id));

const DEFAULT_CLASSIFICATION = Object.freeze({
  category: 'primary',
  categoryLabel: SMART_CATEGORIES.primary.label,
  categoryReason: 'No automated GitHub, log, alert, or service-status signal matched.',
  rule: 'primary.default',
  version: SMART_FILTER_VERSION,
});

const valueFor = (message, ...keys) => {
  for (const key of keys) {
    if (message?.[key] !== null && message?.[key] !== undefined) return message[key];
  }
  return '';
};

const clean = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const parseLabels = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

const extractEmail = (value) => {
  const text = clean(value);
  const match = text.match(/<([^>]+)>/);
  return (match?.[1] || text).replace(/[>\s].*$/, '');
};

const MIDSTATE_DOMAIN_ALIASES = new Set([
  'midstatelitho.com',
  'midstaelitho.com',
  'midstaetlitho.com',
]);

/** Canonicalize addresses so Midstate domain typos collapse together. */
export function normalizeEmailAddress(value) {
  const address = extractEmail(value);
  if (!address.includes('@')) return address;
  const separator = address.lastIndexOf('@');
  const local = address.slice(0, separator);
  const domain = address.slice(separator + 1);
  if (MIDSTATE_DOMAIN_ALIASES.has(domain)) return `${local}@midstatelitho.com`;
  return address;
}

const senderDomain = (email) => {
  const address = normalizeEmailAddress(email);
  const separator = address.lastIndexOf('@');
  return separator >= 0 ? address.slice(separator + 1) : '';
};

const domainMatches = (domain, candidates) => candidates.some((candidate) =>
  domain === candidate || domain.endsWith(`.${candidate}`));

const has = (text, pattern) => pattern.test(text);

const result = (category, categoryReason, rule) => ({
  category,
  categoryLabel: SMART_CATEGORIES[category].label,
  categoryReason,
  rule,
  version: SMART_FILTER_VERSION,
});

const GITHUB_DOMAINS = [
  'github.com',
];

const CI_DOMAINS = [
  'appveyor.com',
  'buildkite.com',
  'circleci.com',
  'codecov.io',
  'dependabot.com',
  'gitlab.com',
  'snyk.io',
  'travis-ci.com',
];

const LOG_ALERT_DOMAINS = [
  'betteruptime.com',
  'checklyhq.com',
  'datadoghq.com',
  'grafana.com',
  'logtail.com',
  'newrelic.com',
  'opsgenie.com',
  'pagerduty.com',
  'papertrailapp.com',
  'sentry.io',
  'splunk.com',
  'uptimerobot.com',
];

const STATUS_DOMAINS = [
  'atlassianstatus.com',
  'githubstatus.com',
  'incident.io',
  'status.io',
  'statuspage.io',
];

const OPS_SOURCE_PATTERNS = [
  { id: 'workboard', test: (hay) => /\bworkboard\b/.test(hay) },
  { id: 'proxmox', test: (hay) => /\bproxmox\b/.test(hay) || /\bpve(?:[-_.@]|\b)/.test(hay) },
  { id: 'watchtower', test: (hay) => /\bwatchtower\b/.test(hay) },
  {
    id: 'xer0_msl_backup',
    test: (hay) => (
      (/\b(?:xer0|msl)\b/.test(hay) && /\bbackup\b/.test(hay))
      || /\b(?:xer0|msl)[-_.\s]?backup\b/.test(hay)
      || /\bbackup[-_.\s]?(?:xer0|msl)\b/.test(hay)
    ),
  },
];

const OPS_ERROR_PATTERN = /\b(?:errors?|failed|failure|fatal|critical|exception|alerting|alerted|unreachable|aborted|abort|panic|traceback|crash(?:ed|ing)?|offline|timed?\s*out|timeout)\b/;
const OPS_ERROR_NEGATION = /\b(?:0|no|without|zero)\s+errors?\b|\bno\s+failure\b|\bwithout\s+failure\b/;
const OPS_SUCCESS_PATTERN = /\b(?:success(?:ful(?:ly)?)?|completed successfully|backup completed|ok|healthy|up to date|updated successfully|no updates|nothing to do|all systems operational)\b/;

function detectOpsSource(haystack) {
  for (const source of OPS_SOURCE_PATTERNS) {
    if (source.test(haystack)) return source.id;
  }
  return null;
}

function isOpsError(subject, preview) {
  const text = `${subject} ${preview}`;
  if (OPS_ERROR_PATTERN.test(text)) {
    // "0 errors" / "no errors" digests are success unless another failure word remains.
    if (OPS_ERROR_NEGATION.test(text) && !/\b(?:failed|failure|fatal|critical|exception|unreachable|aborted|crash|offline|timeout|timed?\s*out)\b/.test(text)) {
      return false;
    }
    return true;
  }
  if (/\bexit(?:\s+code)?[:\s]+[1-9]\d*\b/.test(text)) return true;
  if (/\b(?:status|state)\s*[:=]\s*(?:error|failed|fail|critical|down)\b/.test(text)) return true;
  return false;
}

const personFlagEmailSets = new Map(
  PERSON_FLAGS.map((flag) => [flag.id, new Set(flag.emails.map((email) => normalizeEmailAddress(email)))]),
);

export function getPersonFlag(flagId) {
  return PERSON_FLAGS.find((flag) => flag.id === flagId) || null;
}

export function isPersonFlag(flagId) {
  return personFlagEmailSets.has(String(flagId || ''));
}

export function personFlagEmails(flagId) {
  const set = personFlagEmailSets.get(String(flagId || ''));
  return set ? [...set] : [];
}

/**
 * True when a message involves any of the given addresses in from/to/cc/reply-to.
 */
export function messageMatchesEmails(message, emails) {
  const wanted = new Set((emails || []).map((email) => normalizeEmailAddress(email)).filter(Boolean));
  if (!wanted.size) return false;

  const candidates = [];
  const pushPerson = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      candidates.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(pushPerson);
      return;
    }
    if (typeof value === 'object') {
      if (value.email) candidates.push(value.email);
      if (value.address) candidates.push(value.address);
      if (value.name && value.name.includes('@')) candidates.push(value.name);
    }
  };

  pushPerson(valueFor(message, 'from_email', 'fromEmail') || message?.from);
  pushPerson(message?.from);
  pushPerson(valueFor(message, 'to_json', 'to'));
  pushPerson(message?.to);
  pushPerson(valueFor(message, 'cc_json', 'cc'));
  pushPerson(message?.cc);
  pushPerson(valueFor(message, 'reply_to_json', 'replyTo'));
  pushPerson(message?.replyTo);
  pushPerson(message?.participants);

  // to_json/cc_json may still be serialized JSON strings on raw rows.
  for (const raw of [valueFor(message, 'to_json'), valueFor(message, 'cc_json'), valueFor(message, 'reply_to_json')]) {
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try {
        pushPerson(JSON.parse(raw));
      } catch {
        // ignore malformed JSON; other fields still match
      }
    }
  }

  return candidates.some((candidate) => wanted.has(normalizeEmailAddress(candidate)));
}

export function messageMatchesPersonFlag(message, flagId) {
  return messageMatchesEmails(message, personFlagEmails(flagId));
}

/**
 * Classify a persisted or parsed message using ordered, deterministic rules.
 *
 * The function deliberately uses only metadata already stored by GigaMail. It
 * performs no network calls and returns the stable rule id and human-readable
 * reason that explain every decision.
 */
export function classifyMessage(message = {}) {
  const subject = clean(valueFor(message, 'subject'));
  const fromName = clean(valueFor(message, 'from_name', 'fromName') || message?.from?.name);
  const fromEmail = clean(valueFor(message, 'from_email', 'fromEmail') || message?.from?.email);
  const domain = senderDomain(fromEmail);
  const senderLocalPart = fromEmail.includes('@') ? fromEmail.slice(0, fromEmail.lastIndexOf('@')) : fromEmail;
  const labels = clean(parseLabels(valueFor(message, 'labels_json', 'labels')).join(' '));
  const snippet = clean(valueFor(message, 'snippet'));
  const textBody = clean(valueFor(message, 'text_body', 'textBody'));
  const preview = `${subject} ${snippet} ${textBody.slice(0, 2_000)} ${labels}`;
  const haystack = `${fromName} ${fromEmail} ${domain} ${subject} ${snippet} ${labels}`;

  // Known daily infra digests: only failures belong in the default inbox.
  const opsSource = detectOpsSource(haystack);
  if (opsSource) {
    if (isOpsError(subject, preview)) {
      return result(
        'ops_error',
        `Ops error from ${opsSource.replace(/_/g, ' ')}.`,
        `ops_error.${opsSource}`,
      );
    }
    // Success wording or no error signal: hide from Primary/All even when unread.
    return result(
      'ops_quiet',
      OPS_SUCCESS_PATTERN.test(`${subject} ${preview}`)
        ? `Successful ${opsSource.replace(/_/g, ' ')} digest.`
        : `Routine ${opsSource.replace(/_/g, ' ')} digest with no error signal.`,
      `ops_quiet.${opsSource}`,
    );
  }

  // A status provider can include a product name (for example, "GitHub
  // Status") and severity words. Its domain is the strongest signal, so status
  // feeds take precedence over the GitHub and alert-content rules below.
  if (domainMatches(domain, STATUS_DOMAINS)) {
    return result('status', `Service-status sender (${domain}).`, 'status.sender');
  }

  if (domainMatches(domain, GITHUB_DOMAINS) || /(?:^|\s)github(?:\s|$)/.test(fromName)) {
    return result(
      'github_ci',
      domain ? `GitHub notification sender (${domain}).` : 'Sender is identified as GitHub.',
      'github.sender',
    );
  }

  if (domainMatches(domain, CI_DOMAINS)) {
    return result('github_ci', `Continuous-integration sender (${domain}).`, 'github_ci.sender');
  }

  if (
    has(subject, /^\[[^\]\s]+\/[^\]\s]+\]\s/) ||
    (has(preview, /\b(?:github actions?|pull request|merge request|workflow run|dependabot|code scanning)\b/) &&
      has(preview, /\b(?:failed|failure|passed|success|completed|cancelled|opened|merged|review|build|check|run)\b/))
  ) {
    return result('github_ci', 'Subject or preview matches a source-control or CI notification.', 'github_ci.content');
  }

  if (domainMatches(domain, LOG_ALERT_DOMAINS)) {
    return result('logs', `Monitoring or alerting sender (${domain}).`, 'logs.sender');
  }

  if (/^(?:logs?|cron|daemon|logwatch|telemetry)(?:[+._-]|$)/.test(senderLocalPart)) {
    return result('logs', 'Sender address is dedicated to automated logs or job output.', 'logs.sender_local_part');
  }

  if (
    has(subject, /(?:^|[\s[])\b(?:firing|alerting|critical|sev[0-3]|p[0-3])\b/) ||
    has(subject, /\b(?:monitor|alert|alarm|threshold|error rate|exception|latency|cpu|memory|disk)\b.{0,32}\b(?:triggered|firing|failed|exceeded|critical|high|recovered|resolved)\b/) ||
    has(subject, /\b(?:triggered|firing|critical|failed|exceeded)\b.{0,32}\b(?:monitor|alert|alarm|threshold|health check)\b/) ||
    has(subject, /\b(?:backup|cron|scheduled job|nightly job)\b.{0,64}\b(?:warnings?|errors?|failed|failure|log|report|digest)\b/)
  ) {
    return result('logs', 'Subject contains a monitoring, failure, or alert-severity signal.', 'logs.subject');
  }

  if (
    /^status(?:[-_.]|@)/.test(fromEmail) ||
    /\b(?:service status|status page|incident updates?)\b/.test(fromName)
  ) {
    return result(
      'status',
      'Sender is identified as a service-status feed.',
      'status.sender',
    );
  }

  if (
    has(subject, /\b(?:incident|outage|service disruption|degraded performance|scheduled maintenance)\b.{0,48}\b(?:update|identified|investigating|monitoring|resolved|completed|scheduled)?\b/) ||
    has(subject, /\b(?:service|system|platform)\b.{0,24}\b(?:operational|restored|availability|health|status)\b/) ||
    has(subject, /\b(?:deployment|backup|maintenance)\b.{0,24}\b(?:completed|succeeded|scheduled|started)\b/)
  ) {
    return result('status', 'Subject describes an operational or service-status update.', 'status.subject');
  }

  // Return a fresh object so callers cannot mutate the shared default.
  return { ...DEFAULT_CLASSIFICATION };
}

export function categoryLabel(category) {
  return SMART_CATEGORIES[category]?.label || SMART_CATEGORIES.primary.label;
}

export function isSmartCategory(category) {
  return Object.hasOwn(SMART_CATEGORIES, category);
}

export function isHiddenDefaultCategory(category) {
  return HIDDEN_DEFAULT_CATEGORIES.includes(category);
}
