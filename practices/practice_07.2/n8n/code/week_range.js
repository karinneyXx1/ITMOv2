// «Week range»: период отчёта — последние 7 дней.
const REPO = 'karinneyXx1/tutor-hub';
const DAY = 24 * 60 * 60 * 1000;
const day = (d) => d.toISOString().slice(0, 10);

const until = new Date();
const since = new Date(until.getTime() - 7 * DAY);

return [{
  json: {
    repo: REPO,
    week_start: day(since),
    week_end: day(until),
  },
}];
