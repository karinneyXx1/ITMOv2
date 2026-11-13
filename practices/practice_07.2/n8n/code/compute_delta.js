// «Compute delta»: сравнение с прошлой неделей из Data Table weekly_stats.
// Вход — все строки таблицы (нода Load history); прошлая неделя — самая поздняя
// строка с week_start раньше текущей.
const current = $('Group stats').first().json;

const METRICS = [
  'issues_opened', 'issues_closed', 'prs_opened', 'prs_merged',
  'bug', 'task', 'feature', 'needs_triage', 'spam',
];

const flat = {
  ...current.totals,
  bug: current.by_type.bug,
  task: current.by_type.task,
  feature: current.by_type.feature,
  needs_triage: current.by_type['needs-triage'],
  spam: current.by_type.spam,
};

const history = $input.all()
  .map((item) => item.json)
  .filter((row) => row.week_start && row.week_start < current.week_start)
  .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
const prevRow = history[0] ?? null;

const prev = prevRow ? Object.fromEntries(METRICS.map((m) => [m, Number(prevRow[m] ?? 0)])) : null;
const delta = prev ? Object.fromEntries(METRICS.map((m) => [m, flat[m] - prev[m]])) : null;

return [{
  json: {
    ...current,
    metrics: METRICS,
    current: flat,
    prev_week_start: prevRow ? prevRow.week_start : null,
    prev,
    delta,
  },
}];
