// «Build context»: содержимое файлов (GitHub отдаёт base64) → один текст для модели.
const decode = (b64) => {
  const clean = String(b64 || '').replace(/\n/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  return new TextDecoder().decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)));
};

const files = $input.all().map((item) => ({
  path: item.json.path,
  sha: item.json.sha,
  content: decode(item.json.content),
}));

const context = files
  .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
  .join('\n\n');

return [{
  json: {
    files: files.map(({ path, sha }) => ({ path, sha })),
    context,
  },
}];
