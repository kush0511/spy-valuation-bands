import { test } from "node:test";
import assert from "node:assert/strict";
import { ageInDays, periodStart } from "../../src/lib/valuation.ts";
import { validateRows } from "../data-validation.mjs";
const dates = (values) =>
  values.map((date) => ({ date, spx: 6000, eps: 300, pe: 20 }));
test("month ranges clamp to month end, including leap years", () => {
  const rows = dates(["2024-02-28", "2024-02-29", "2024-03-01", "2024-03-31"]);
  assert.equal(periodStart(rows, "1M"), 1);
  assert.equal(
    periodStart(dates(["2025-02-27", "2025-02-28", "2025-03-31"]), "1M"),
    1,
  );
});
test("year ranges, YTD, missing trading dates and all history", () => {
  const rows = dates([
    "2023-09-18",
    "2025-09-17",
    "2025-09-18",
    "2026-01-02",
    "2026-03-18",
    "2026-06-18",
    "2026-08-18",
    "2026-09-18",
  ]);
  for (const [period, index] of [
    ["1M", 6],
    ["3M", 5],
    ["6M", 4],
    ["YTD", 3],
    ["1Y", 2],
    ["3Y", 0],
    ["ALL", 0],
  ])
    assert.equal(periodStart(rows, period), index);
  assert.equal(
    periodStart(dates(["2025-02-28", "2025-03-03", "2025-04-01"]), "1M"),
    1,
  );
});
test("freshness uses current UTC day, not generation date", () => {
  assert.equal(ageInDays("2026-09-18", new Date("2026-09-21T20:00:00Z")), 3);
  assert.equal(ageInDays("2026-09-08", new Date("2026-09-21T00:00:00Z")), 13);
});
const sourceRows = [
  { Date: "2026-09-18", SPX: 6000, ntmE: 300, ntmPE: 20 },
  { Date: "2026-09-17", SPX: 5990, ntmE: 300, ntmPE: 19.97 },
];
const options = {
  minimumRows: 2,
  previousAsOf: "2026-09-17",
  now: new Date("2026-09-21T00:00:00Z"),
};
test("source validation sorts valid market dates", () => {
  assert.deepEqual(
    validateRows(sourceRows, options).map((row) => row.date),
    ["2026-09-17", "2026-09-18"],
  );
});
test("rejects invalid, duplicate, stale, regressed or future source data", () => {
  assert.throws(() => validateRows({}, options), /invalid/);
  assert.throws(() => validateRows([sourceRows[0]], options), /small/);
  assert.throws(
    () => validateRows([sourceRows[0], sourceRows[0]], options),
    /Duplicate/,
  );
  assert.throws(
    () => validateRows([{ ...sourceRows[0], ntmE: 0 }, sourceRows[1]], options),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateRows(
        [{ ...sourceRows[0], Date: "2026-02-30" }, sourceRows[1]],
        options,
      ),
    /Invalid/,
  );
  assert.throws(
    () => validateRows(sourceRows, { ...options, previousAsOf: "2026-09-21" }),
    /regressed/,
  );
  assert.throws(
    () => validateRows(sourceRows, { ...options, now: new Date("2026-09-30") }),
    /stale/,
  );
  assert.throws(
    () => validateRows(sourceRows, { ...options, now: new Date("2026-09-16") }),
    /Future/,
  );
});
