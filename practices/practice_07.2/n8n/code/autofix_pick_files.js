// «Pick source files»: какие файлы репозитория показать модели.
// Код сервера, тесты и правила проекта для AI-агентов (AGENTS.md).
const tree = $input.first().json.tree || [];
const keep = (path) =>
  path === 'AGENTS.md' ||
  (/^backend\/(app|tests)\/.+\.py$/.test(path) && !path.endsWith('__init__.py'));

return tree
  .filter((entry) => entry.type === 'blob' && keep(entry.path))
  .map((entry) => ({ json: { path: entry.path } }));
