// «CI status»: итог проверок GitHub Actions по последнему коммиту PR.
// Сценарий ждёт и проверяет снова, пока проверки не завершатся (максимум 12 попыток).
const MAX_ATTEMPTS = 12;
const runs = $input.first().json.check_runs || [];
const attempt = $runIndex + 1;

let state;
if (!runs.length || runs.some((r) => r.status !== 'completed')) {
  state = attempt >= MAX_ATTEMPTS ? 'timeout' : 'pending';
} else {
  const ok = runs.every((r) => ['success', 'skipped', 'neutral'].includes(r.conclusion));
  state = ok ? 'success' : 'failure';
}

return [{
  json: {
    state,
    attempt,
    runs: runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
  },
}];
