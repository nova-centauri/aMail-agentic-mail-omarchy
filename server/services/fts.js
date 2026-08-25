/**
 * Turn a mailbox search box value into a conservative FTS5 MATCH query.
 * User text is tokenized; FTS operators from the operator are not honored.
 */
export function toFtsMatchQuery(raw) {
  const tokens = String(raw || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9@._+-]*/g) || [];
  if (!tokens.length) return '';
  return tokens.slice(0, 12).map((token) => `"${token.replace(/"/g, '')}"*`).join(' AND ');
}

export function ftsDocument(row, json) {
  const recipients = [...json(row.to_json), ...json(row.cc_json), ...json(row.bcc_json)]
    .map((item) => `${item?.name || ''} ${item?.email || ''}`)
    .join(' ');
  return {
    rowid: row.rowid,
    subject: row.subject || '',
    snippet: row.snippet || '',
    from_name: row.from_name || '',
    from_email: row.from_email || '',
    recipients,
    text_body: String(row.text_body || '').slice(0, 80_000),
  };
}
