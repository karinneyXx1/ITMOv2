// n8n Code node «Split diff» (Run Once for All Items).
// Режет diff на файлы и блоки (hunks) и нумерует строки нового кода,
// чтобы модель могла сослаться на конкретную строку, а GitHub принял комментарий.
const diff = $input.first().json.data || '';

const valid = {};      // путь файла -> номера добавленных строк (куда можно ставить комментарий)
const annotated = [];  // diff с номерами строк для модели
let path = null;       // текущий файл
let newLine = 0;       // номер строки в новой версии файла
let inHunk = false;

for (const raw of diff.split('\n')) {
  if (raw.startsWith('diff --git')) {
    path = null;
    inHunk = false;
    annotated.push('', raw);
    continue;
  }
  if (!inHunk && raw.startsWith('+++ ')) {
    const p = raw.slice(4).trim();
    path = p === '/dev/null' ? null : p.replace(/^b\//, '');
    if (path) valid[path] = [];
    annotated.push(raw);
    continue;
  }
  // Заголовок блока: @@ -старт,длина +старт,длина @@
  const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (hunk) {
    newLine = parseInt(hunk[1], 10);
    inHunk = true;
    annotated.push(raw);
    continue;
  }
  if (!inHunk || !path) {
    annotated.push(raw);
    continue;
  }
  if (raw.startsWith('+')) {
    // добавленная строка: есть в новой версии, на неё можно комментировать
    valid[path].push(newLine);
    annotated.push(`L${newLine} ${raw}`);
    newLine++;
  } else if (raw.startsWith('-')) {
    // удалённая строка: в новой версии её нет, номер не растёт
    annotated.push(`     ${raw}`);
  } else if (raw.startsWith('\\')) {
    // "\ No newline at end of file" — служебная строка
  } else {
    // строка контекста: есть в обеих версиях
    annotated.push(`L${newLine} ${raw}`);
    newLine++;
  }
}

return [{ json: { annotated: annotated.join('\n').trim(), valid } }];
