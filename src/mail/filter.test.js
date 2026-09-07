import { describe, expect, it } from 'vitest';
import { filterVisibleThreads } from './filter.js';

const threads = [
  { id: 'note', folder: 'inbox', subject: 'Lunch', snippet: 'Want to grab lunch?', from: { name: 'Alice', email: 'alice@example.com' }, category: 'primary', labels: [] },
  { id: 'quiet', folder: 'inbox', subject: 'Watchtower: all containers up to date', snippet: 'No updates', from: { name: 'Watchtower', email: 'watchtower@home.lab' }, category: 'ops_quiet', labels: [] },
  { id: 'fail', folder: 'inbox', subject: 'Proxmox backup failed', snippet: 'vzdump error', from: { name: 'Proxmox', email: 'root@proxmox.local' }, category: 'ops_error', labels: [] },
  { id: 'note-file', folder: 'inbox', subject: 'Lunch menu', snippet: 'PDF attached', from: { name: 'Alice', email: 'alice@example.com' }, category: 'primary', labels: [], hasAttachments: true },
];

describe('filterVisibleThreads', () => {
  it('hides routine ops digests from the default inbox', () => {
    const visible = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: '' });
    expect(visible.map((thread) => thread.id)).toEqual(['note', 'fail', 'note-file']);
  });

  it('still finds quiet digests when searching', () => {
    const visible = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: 'Watchtower' });
    expect(visible.map((thread) => thread.id)).toEqual(['quiet']);
  });

  it('shows saved drafts only in the drafts folder', () => {
    const draft = { id: 'draft:1', draftId: '1', folder: 'drafts', subject: 'WIP', snippet: 'later', from: { name: 'Me', email: 'me@example.com' }, category: 'primary', labels: ['Draft'] };
    const visible = filterVisibleThreads([...threads, draft], { activeFolder: 'drafts', activeCategory: 'all', query: '' });
    expect(visible.map((thread) => thread.id)).toEqual(['draft:1']);
  });

  it('honors from: and has:attachment operators', () => {
    const fromAlice = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: 'from:alice' });
    expect(fromAlice.map((thread) => thread.id)).toEqual(['note', 'note-file']);
    const withFiles = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: 'from:alice has:attachment' });
    expect(withFiles.map((thread) => thread.id)).toEqual(['note-file']);
  });
});

describe('person flags and the analyzed flag', () => {
  const flags = [{ id: 'alice', label: 'Alice', emails: ['Alice@Example.com'], color: '#0b57d0' }];

  it('matches configured person flags case-insensitively across any address role', () => {
    const cc = { id: 'cc', folder: 'inbox', subject: 'FYI', snippet: '', from: { email: 'bob@example.com' }, cc: [{ email: 'alice@example.com' }], category: 'primary', labels: [] };
    const visible = filterVisibleThreads([...threads, cc], { activeFolder: 'inbox', activeCategory: 'all', activePersonFlag: 'alice', personFlags: flags, query: '' });
    expect(visible.map((thread) => thread.id)).toEqual(['note', 'note-file', 'cc']);
  });

  it('shows nothing for a flag id that is not configured', () => {
    const visible = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', activePersonFlag: 'ghost', personFlags: flags, query: '' });
    expect(visible).toEqual([]);
  });

  it('supports the agent queue search is:unanalyzed', () => {
    const mixed = threads.map((thread, index) => ({ ...thread, analyzed: index % 2 === 0 }));
    const pending = filterVisibleThreads(mixed, { activeFolder: 'inbox', activeCategory: 'all', query: 'is:unanalyzed' });
    expect(pending.map((thread) => thread.id)).toEqual(['quiet', 'note-file']);
    const done = filterVisibleThreads(mixed, { activeFolder: 'inbox', activeCategory: 'all', query: 'is:analyzed' });
    expect(done.map((thread) => thread.id)).toEqual(['note', 'fail']);
  });
});
