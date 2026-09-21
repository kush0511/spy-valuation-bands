export function validateRows(
  input,
  { previousAsOf, now = new Date(), minimumRows = 1000 } = {},
) {
  if (!Array.isArray(input) || input.length < minimumRows) {
    throw new Error(
      `Unexpectedly small or invalid valuation dataset: ${input?.length}`,
    );
  }
  const rows = input
    .map((row) => {
      const date = String(row.Date).slice(0, 10);
      const values = [row.SPX, row.ntmE, row.ntmPE].map(Number);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date ||
        values.some((value) => !Number.isFinite(value) || value <= 0)
      ) {
        throw new Error(`Invalid valuation row at ${date}`);
      }
      return { date, spx: values[0], eps: values[1], pe: values[2] };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.some((row, i) => i > 0 && row.date === rows[i - 1].date))
    throw new Error("Duplicate market dates");
  const latest = rows.at(-1).date;
  if (latest > now.toISOString().slice(0, 10))
    throw new Error(`Future market date: ${latest}`);
  if (previousAsOf && latest < previousAsOf)
    throw new Error(`Source regressed from ${previousAsOf} to ${latest}`);
  // Weekends and holidays are allowed; a week-old source fails the refresh visibly.
  if (now.getTime() - Date.parse(`${latest}T00:00:00Z`) > 7 * 86_400_000)
    throw new Error(`Source is stale: ${latest}`);
  return rows;
}
