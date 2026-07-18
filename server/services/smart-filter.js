const CATEGORY_DEFINITIONS = [
  ['primary', 'Primary'],
  ['github_ci', 'GitHub & CI'],
  ['logs', 'Logs & alerts'],
  ['status', 'Status updates'],
];

export const SMART_FILTER_VERSION = 1;

export const SMART_CATEGORIES = Object.freeze(Object.fromEntries(
  CATEGORY_DEFINITIONS.map(([slug, label]) => [slug, Object.freeze({ slug, label })]),
));

export const SMART_CATEGORY_SLUGS = Object.freeze(CATEGORY_DEFINITIONS.map(([slug]) => slug));

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

const senderDomain = (email) => {
  const address = clean(email).replace(/^.*<([^>]+)>.*$/, '$1');
  const separator = address.lastIndexOf('@');
  return separator >= 0 ? address.slice(separator + 1).replace(/[>\s].*$/, '') : '';
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
