// «Prepare commit»: проверяет ответ модели и готовит по одному запросу
// PUT /contents/{path} на каждый изменённый файл.
const encode = (text) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};

const event = $('Github Trigger').first().json.body;
const issue = event.issue.number;
const branch = `fix/issue-${issue}`;
const known = Object.fromEntries($('Build context').first().json.files.map((f) => [f.path, f.sha]));
const fix = $('Write fix').first().json.output || {};

// Менять можно только уже существующие файлы из контекста или добавить новый тест.
const allowed = (path) => path in known || /^backend\/tests\/test_[a-z0-9_]+\.py$/.test(path);
const files = (fix.files || []).filter((f) => f && allowed(f.path) && typeof f.content === 'string');
if (!files.length) {
  throw new Error('Модель не вернула ни одного допустимого файла для исправления');
}

return files.map((f) => ({
  json: {
    path: f.path,
    branch,
    body: {
      message: `Fix #${issue}: update ${f.path}`,
      content: encode(f.content.endsWith('\n') ? f.content : `${f.content}\n`),
      branch,
      ...(known[f.path] ? { sha: known[f.path] } : {}),
    },
  },
}));
