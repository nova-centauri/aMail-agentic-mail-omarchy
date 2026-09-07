import { describe, expect, it } from 'vitest';
import {
  collectKnownPeople,
  parseRecipientList,
  parseRecipientToken,
  suggestRecipients,
} from './people.js';

describe('recipient parsing', () => {
  it('reads bare addresses and name-angle tokens', () => {
    expect(parseRecipientToken('maya@studio.com')).toEqual({ name: '', email: 'maya@studio.com', valid: true });
    expect(parseRecipientToken('Maya Chen <maya@studio.com>')).toEqual({
      name: 'Maya Chen',
      email: 'maya@studio.com',
      valid: true,
    });
    expect(parseRecipientList('Maya Chen <maya@studio.com>, avery@ops.example').map((item) => item.email)).toEqual([
      'maya@studio.com',
      'avery@ops.example',
    ]);
    expect(parseRecipientToken('not-an-email').valid).toBe(false);
  });
});

describe('known people', () => {
  it('collects unique mailbox contacts and ranks suggestions', () => {
    const people = collectKnownPeople(
      [{ name: 'Sam', email: 'sam@rivera.example' }],
      [{
        from: { name: 'Maya Chen', email: 'maya@studio.com' },
        to: ['Jordan Lee <jordan@studio.com>'],
        messages: [{ from: { name: 'Avery Thompson', email: 'avery@ops.example' } }],
      }],
    );
    expect(people.map((item) => item.email)).toEqual([
      'avery@ops.example',
      'jordan@studio.com',
      'maya@studio.com',
      'sam@rivera.example',
    ]);
    expect(suggestRecipients(people, 'may', [{ email: 'sam@rivera.example' }]).map((item) => item.email)).toEqual([
      'maya@studio.com',
    ]);
  });
});
