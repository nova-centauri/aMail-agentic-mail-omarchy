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

  it('honors from: and has:attachment operators', () => {
    const fromAlice = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: 'from:alice' });
    expect(fromAlice.map((thread) => thread.id)).toEqual(['note', 'note-file']);
    const withFiles = filterVisibleThreads(threads, { activeFolder: 'inbox', activeCategory: 'all', query: 'from:alice has:attachment' });
    expect(withFiles.map((thread) => thread.id)).toEqual(['note-file']);
  });
});
