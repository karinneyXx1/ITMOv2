// «Group stats»: группировка данных четырёх запросов к GitHub по типу и по автору.
const range = $('Week range').first().json;
const result = (name) => $(name).first().json;

const issuesOpened = result('Issues opened');
const issuesClosed = result('Issues closed');
const prsOpened = result('PRs opened');
const prsMerged = result('PRs merged');

// Тип Issue = метка, которую поставил WF1
const TYPES = ['bug', 'task', 'feature', 'needs-triage', 'spam'];
const typeOf = (issue) => {
  const names = (issue.labels || []).map((l) => l.name);
  return TYPES.find((t) => names.includes(t)) || 'no-label';
};

const byType = Object.fromEntries([...TYPES, 'no-label'].map((t) => [t, 0]));
for (const issue of issuesOpened.items || []) byType[typeOf(issue)] += 1;

// Автор: сколько Issues и PR открыл за неделю
const byAuthor = {};
const author = (login) => (byAuthor[login] ??= { issues: 0, prs: 0 });
for (const issue of issuesOpened.items || []) author(issue.user.login).issues += 1;
for (const pr of prsOpened.items || []) author(pr.user.login).prs += 1;

return [{
  json: {
    repo: range.repo,
    week_start: range.week_start,
    week_end: range.week_end,
    totals: {
      issues_opened: issuesOpened.total_count ?? 0,
      issues_closed: issuesClosed.total_count ?? 0,
      prs_opened: prsOpened.total_count ?? 0,
      prs_merged: prsMerged.total_count ?? 0,
    },
    by_type: byType,
    by_author: byAuthor,
  },
}];
