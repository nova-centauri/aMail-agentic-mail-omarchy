import { ValidationError } from '../errors.js';
import { messageMatchesEmails, normalizeEmailAddress } from './smart-filter.js';

/**
 * Person flags are operator-defined "people folders": a label plus the
 * addresses that belong to it. They live in the settings table so they can be
 * edited from the UI, the REST API, or an MCP tool without a redeploy.
 */
export const PERSON_FLAGS_SETTING = 'personFlags';
export const MAX_PERSON_FLAGS = 24;
export const MAX_FLAG_EMAILS = 32;

const FLAG_COLORS = ['#0b57d0', '#c2185b', '#00897b', '#e8710a', '#6c4fc7', '#8e24aa', '#455a64', '#2e7d32'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function slugifyFlagId(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function normalizeFlag(input, index, usedIds) {
  if (!input || typeof input !== 'object') throw new ValidationError('Each person flag must be an object.');
  const label = String(input.label || input.name || '').trim().slice(0, 60);
  if (!label) throw new ValidationError('Each person flag needs a label.');
  let id = slugifyFlagId(input.id || label);
  if (!id) throw new ValidationError(`The flag "${label}" needs an id made of letters or digits.`);
  if (usedIds.has(id)) throw new ValidationError(`Person flag ids must be unique ("${id}" appears twice).`);
  usedIds.add(id);
  const rawEmails = Array.isArray(input.emails)
    ? input.emails
    : String(input.emails || '').split(/[,\s;]+/);
  const emails = [...new Set(rawEmails.map((email) => normalizeEmailAddress(email)).filter(Boolean))];
  if (!emails.length) throw new ValidationError(`The flag "${label}" needs at least one email address.`);
  if (emails.length > MAX_FLAG_EMAILS) throw new ValidationError(`The flag "${label}" lists too many addresses (max ${MAX_FLAG_EMAILS}).`);
  const invalid = emails.find((email) => !emailPattern.test(email));
  if (invalid) throw new ValidationError(`"${invalid}" is not a valid email address for the flag "${label}".`);
  const color = /^#[0-9a-f]{6}$/i.test(String(input.color || ''))
    ? String(input.color).toLowerCase()
    : FLAG_COLORS[index % FLAG_COLORS.length];
  return Object.freeze({
    id,
    label,
    shortLabel: String(input.shortLabel || label).trim().slice(0, 24) || label,
    description: String(input.description || `Mail involving ${label}`).trim().slice(0, 160),
    color,
    emails: Object.freeze(emails),
  });
}

/** Validate and canonicalize a flag list from any caller (API, MCP, settings). */
export function normalizePersonFlags(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ValidationError('Person flags must be an array.');
  if (input.length > MAX_PERSON_FLAGS) throw new ValidationError(`At most ${MAX_PERSON_FLAGS} person flags are supported.`);
  const usedIds = new Set();
  return input.map((flag, index) => normalizeFlag(flag, index, usedIds));
}

export function loadPersonFlags(repos) {
  try {
    return normalizePersonFlags(repos.settings.get(PERSON_FLAGS_SETTING));
  } catch {
    // A hand-edited or corrupt setting must not take the inbox down.
    return [];
  }
}

export function savePersonFlags(repos, input) {
  const flags = normalizePersonFlags(input);
  repos.settings.set(PERSON_FLAGS_SETTING, flags.map((flag) => ({ ...flag, emails: [...flag.emails] })));
  return flags;
}

export function getPersonFlag(flags, flagId) {
  return flags.find((flag) => flag.id === String(flagId || '')) || null;
}

export function messageMatchesPersonFlag(message, flag) {
  if (!flag) return false;
  return messageMatchesEmails(message, flag.emails);
}

export function publicPersonFlag(flag) {
  return {
    id: flag.id,
    label: flag.label,
    shortLabel: flag.shortLabel,
    description: flag.description,
    color: flag.color,
    emails: [...flag.emails],
  };
}
