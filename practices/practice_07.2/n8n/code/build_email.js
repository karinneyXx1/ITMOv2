// «Build email»: HTML-письмо со статистикой, Δ и AI-комментарием.
const s = $('Compute delta').first().json;
const aiComment = ($('AI comment').first().json.text || '').trim();

const LABELS = {
  issues_opened: 'Issues открыто',
  issues_closed: 'Issues закрыто',
  prs_opened: 'PR открыто',
  prs_merged: 'PR смержено',
  bug: 'bug',
  task: 'task',
  feature: 'feature',
  needs_triage: 'needs-triage',
  spam: 'spam',
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const td = 'style="padding:6px 12px;border:1px solid #ddd"';
const th = 'style="padding:6px 12px;border:1px solid #ddd;background:#f3f4f6;text-align:left"';
const table = (head, rows) =>
  `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin-bottom:20px">
    <tr>${head.map((h) => `<th ${th}>${esc(h)}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td ${td}>${c}</td>`).join('')}</tr>`).join('')}
  </table>`;

const deltaCell = (d) => {
  if (d === null || d === undefined) return '—';
  if (d === 0) return '0';
  const color = d > 0 ? '#15803d' : '#b91c1c';
  return `<span style="color:${color}">${d > 0 ? '▲ +' : '▼ '}${d}</span>`;
};

const metricRows = (keys) => keys.map((k) => [
  esc(LABELS[k]),
  esc(s.current[k]),
  s.prev ? esc(s.prev[k]) : '—',
  deltaCell(s.delta ? s.delta[k] : null),
]);

const head = ['Показатель', 'Эта неделя', s.prev_week_start ? `Прошлая (с ${s.prev_week_start})` : 'Прошлая', 'Δ'];
const authors = Object.entries(s.by_author)
  .sort((a, b) => (b[1].issues + b[1].prs) - (a[1].issues + a[1].prs))
  .map(([login, c]) => [esc(login), esc(c.issues), esc(c.prs)]);

const html = `<div style="font-family:Arial,sans-serif;color:#111">
  <h2>Неделя проекта ${esc(s.repo)}</h2>
  <p>Период: ${esc(s.week_start)} — ${esc(s.week_end)}</p>
  <h3>Активность</h3>
  ${table(head, metricRows(['issues_opened', 'issues_closed', 'prs_opened', 'prs_merged']))}
  <h3>Новые Issues по типам</h3>
  ${table(head, metricRows(['bug', 'task', 'feature', 'needs_triage', 'spam']))}
  <h3>По авторам</h3>
  ${authors.length ? table(['Автор', 'Issues', 'PR'], authors) : '<p>За неделю новых Issues и PR не было.</p>'}
  <h3>AI-комментарий недели</h3>
  <div style="padding:12px 16px;background:#eef2ff;border-left:4px solid #6366f1;max-width:640px">${esc(aiComment) || '—'}</div>
</div>`;

return [{
  json: {
    subject: `Неделя проекта ${s.repo}: ${s.week_start} — ${s.week_end}`,
    html,
  },
}];
