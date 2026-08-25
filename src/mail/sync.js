export function syncResultStatus(payload) {
  const source = payload?.result ?? payload?.results ?? payload;
  const results = Array.isArray(source) ? source : source ? [source] : [];
  if (!results.length) return 'ok';
  if (results.every((result) => result?.skipped)) return 'skipped';
  if (results.some((result) => result?.skipped)) return 'partial';
  const statuses = results.map((result) => result?.status).filter(Boolean);
  if (statuses.length && statuses.every((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'failed' || status === 'partial')) return 'partial';
  return 'ok';
}

export function syncSkippedMessageCount(payload) {
  const source = payload?.result ?? payload?.results ?? payload;
  const results = Array.isArray(source) ? source : source ? [source] : [];
  return results.reduce((sum, result) => sum + (typeof result?.skipped === 'number' ? Math.max(0, result.skipped) : 0), 0);
}
