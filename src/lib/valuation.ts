export type Datum = { date: string; spx: number; eps: number; pe: number };
export const PERIODS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL"] as const;
export type Period = (typeof PERIODS)[number];
export const MULTIPLES = [16, 18, 20, 22, 24, 26];

// Calendar subtraction clamps month ends (March 31 → February 28/29).
export function periodStart(rows: Datum[], period: Period) {
  if (!rows.length || period === "ALL") return 0;
  const latest = new Date(`${rows.at(-1)!.date}T00:00:00Z`);
  let target: Date;
  if (period === "YTD") {
    target = new Date(Date.UTC(latest.getUTCFullYear(), 0, 1));
  } else {
    const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[period];
    target = new Date(
      Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - months, 1),
    );
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(latest.getUTCDate(), lastDay));
  }
  const index = rows.findIndex(
    (row) => row.date >= target.toISOString().slice(0, 10),
  );
  return index < 0 ? rows.length - 1 : index;
}

export function ageInDays(date: string, now = new Date()) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.max(
    0,
    Math.floor((today - Date.parse(`${date}T00:00:00Z`)) / 86_400_000),
  );
}
