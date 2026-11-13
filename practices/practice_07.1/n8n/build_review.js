// n8n Code node «Build review» (Run Once for All Items).
// Берёт JSON-ответ модели, оставляет только комментарии к реально добавленным строкам
// и собирает тело запроса POST /repos/{owner}/{repo}/pulls/{n}/reviews.
const output = $input.first().json.output || '';
const valid = $('Split diff').first().json.valid;
const meta = $('Get PR meta').first().json;
const command = $('PR Trigger1').first().json.body.comment?.body || '';
const model = command.includes('/make_other_ai_review')
  ? 'anthropic/claude-sonnet-4.6'
  : 'openai/gpt-5.2';

// Модель иногда оборачивает JSON в ```json ... ``` — вырезаем сам объект.
let parsed;
try {
  const match = output.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(match ? match[0] : output);
} catch (e) {
  parsed = { summary: output, comments: [] };
}

const comments = [];
const skipped = [];
for (const c of parsed.comments || []) {
  const line = Number(c.line);
  if (valid[c.path] && valid[c.path].includes(line)) {
    comments.push({ path: c.path, line, side: 'RIGHT', body: c.body });
  } else {
    skipped.push(c); // строки нет в diff — GitHub отклонил бы весь запрос
  }
}

let body = `**Модель: ${model}**\n\n${parsed.summary || ''}`;
if (skipped.length) {
  body += '\n\n**Замечания без привязки к строке:**\n'
    + skipped.map(c => `- \`${c.path}:${c.line}\` — ${c.body}`).join('\n');
}

return [{
  json: {
    url: `${meta.url}/reviews`,
    inline_count: comments.length,
    skipped_count: skipped.length,
    payload: { commit_id: meta.head.sha, body, event: 'COMMENT', comments },
  },
}];
