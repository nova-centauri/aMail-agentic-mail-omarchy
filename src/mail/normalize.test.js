import { describe, expect, it } from 'vitest';
import { inferSmartCategory, smartCategoryMetadata } from './classify.js';
import { normalizeThread } from './normalize.js';

describe('smart category metadata', () => {
  it('trusts an explicit API category instead of re-classifying live mail', () => {
    const metadata = smartCategoryMetadata({
      subject: '[aMail] CI failed on main',
      snippet: 'The test job failed after 2m 18s',
      from: { name: 'GitHub Actions', email: 'notifications@github.com' },
      category: 'primary',
      categoryLabel: 'Primary',
      categoryReason: 'Kept in Primary because a teammate replied.',
    });
    expect(metadata.category).toBe('primary');
    expect(metadata.categoryReason).toBe('Kept in Primary because a teammate replied.');
  });

  it('infers a category for preview threads that omit server metadata', () => {
    expect(inferSmartCategory({
      subject: '[aMail] CI failed on main',
      from: { email: 'notifications@github.com' },
    }).category).toBe('github_ci');
  });
});

describe('normalizeThread', () => {
  it('keeps attachment download URLs from the API', () => {
    const thread = normalizeThread({
      id: 't1',
      subject: 'Invoice',
      category: 'primary',
      messages: [{
        id: 'm1',
        from: { name: 'Figma', email: 'billing@figma.com' },
        attachments: [{ filename: 'invoice.pdf', size: 1280, url: '/api/content/attachment?token=abc' }],
      }],
    });
    expect(thread.messages[0].attachments[0].name).toBe('invoice.pdf');
    expect(thread.messages[0].attachments[0].url).toBe('/api/content/attachment?token=abc');
    expect(thread.category).toBe('primary');
  });
});
