// Shift hours and Kathmandu calendar days. No database: pure date maths, so it runs under any host time
// zone (run it with TZ=UTC, TZ=America/New_York and TZ=Asia/Kathmandu: the answers must not change).
const { resolveShiftTimes, SHIFT_DEFAULTS, nepalCalendarDay, startOfNepalDay, nepalDaysBetween, lastBookableDay } = require("../services/shiftService");
const { assertPreferredDate } = require("../services/inquiryService");
const { slotKeysFor } = require("../utils/slotKeys");

const KTM = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kathmandu",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// The wall clock in Kathmandu for an instant, "YYYY-MM-DD HH:mm". Independent of the code under test.
const wall = (instant) => {
  const p = Object.fromEntries(KTM.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

describe("host time zone", () => {
  it("is applied when TZ is given (so the matrix really changes the host zone)", () => {
    if (process.env.TZ === "America/New_York") expect([240, 300]).toContain(new Date(2026, 5, 1).getTimezoneOffset());
    if (process.env.TZ === "Asia/Kathmandu") expect(new Date(2026, 5, 1).getTimezoneOffset()).toBe(-345);
    if (process.env.TZ === "UTC") expect(new Date(2026, 5, 1).getTimezoneOffset()).toBe(0);
  });
});

describe("resolveShiftTimes: default shifts", () => {
  // [Kathmandu day, label, an instant that falls on that Kathmandu day]
  const days = [
    ["2026-11-18", "noon in Kathmandu", "2026-11-18T06:15:00.000Z"],
    ["2026-11-18", "00:00 in Kathmandu (the day before in UTC)", "2026-11-17T18:15:00.000Z"],
    ["2026-11-18", "23:59:59.999 in Kathmandu (same UTC day)", "2026-11-18T18:14:59.999Z"],
    ["2026-11-18", "UTC midnight (05:45 in Kathmandu)", "2026-11-18T00:00:00.000Z"],
    ["2026-11-19", "the instant the Kathmandu day rolls over", "2026-11-18T18:15:00.000Z"],
    ["2026-12-31", "last day of the year", "2026-12-31T06:15:00.000Z"],
    ["2027-01-01", "first day of the year, reached from the UTC evening before", "2026-12-31T18:15:00.000Z"],
    ["2026-01-31", "end of January", "2026-01-31T06:15:00.000Z"],
    ["2026-03-01", "after a 28-day February, from the previous UTC evening", "2026-02-28T18:15:00.000Z"],
    ["2028-02-28", "day before the leap day", "2028-02-28T06:15:00.000Z"],
    ["2028-02-29", "leap day", "2028-02-29T06:15:00.000Z"],
    ["2028-02-29", "leap day from the UTC evening before", "2028-02-28T18:15:00.000Z"],
    ["2028-03-01", "day after the leap day", "2028-02-29T18:15:00.000Z"],
    ["2100-03-01", "2100 is not a leap year", "2100-02-28T18:15:00.000Z"],
    ["2026-03-08", "US daylight saving starts", "2026-03-08T06:15:00.000Z"],
    ["2026-11-01", "US daylight saving ends", "2026-11-01T06:15:00.000Z"],
    ["2026-03-29", "EU daylight saving starts", "2026-03-29T06:15:00.000Z"],
    ["2026-10-25", "EU daylight saving ends", "2026-10-25T06:15:00.000Z"],
  ];
  const shifts = [
    ["day", "10:00", "15:00"],
    ["night", "17:00", "22:00"],
    ["full_day", "10:00", "22:00"],
  ];

  const cases = days.flatMap(([day, label, instant]) => shifts.map(([shift, from, to]) => [day, label, instant, shift, from, to]));

  it.each(cases)("%s (%s) %s -> %s %s-%s Kathmandu", (day, _label, instant, shift, from, to) => {
    const { startTime, endTime } = resolveShiftTimes(new Date(instant), shift);
    expect(wall(startTime)).toBe(`${day} ${from}`);
    expect(wall(endTime)).toBe(`${day} ${to}`);
  });

  it("matches the documented defaults and always lasts 5, 5 and 12 hours, even across daylight saving changes elsewhere", () => {
    expect(SHIFT_DEFAULTS).toEqual({
      day: { startTime: "10:00", endTime: "15:00" },
      night: { startTime: "17:00", endTime: "22:00" },
      full_day: { startTime: "10:00", endTime: "22:00" },
    });
    for (const [, , instant] of days) {
      const hours = (s) => {
        const { startTime, endTime } = resolveShiftTimes(new Date(instant), s);
        return (endTime - startTime) / 3600000;
      };
      expect([hours("day"), hours("night"), hours("full_day")]).toEqual([5, 5, 12]);
    }
  });

  it("gives the same answer for every instant of one Kathmandu day (sampled every 15 minutes)", () => {
    const first = Date.parse("2026-11-17T18:15:00.000Z");
    const expected = resolveShiftTimes(new Date(first), "day");
    for (let i = 0; i < 96; i++) {
      const got = resolveShiftTimes(new Date(first + i * 15 * 60000), "day");
      expect(got.startTime.getTime()).toBe(expected.startTime.getTime());
      expect(got.endTime.getTime()).toBe(expected.endTime.getTime());
    }
    const next = resolveShiftTimes(new Date(first + 96 * 15 * 60000), "day");
    expect(next.startTime.getTime() - expected.startTime.getTime()).toBe(24 * 3600000);
  });

  it("keeps day and night apart (15:00 < 17:00) and lets the full day cover both", () => {
    const at = new Date("2026-11-18T06:15:00Z");
    const day = resolveShiftTimes(at, "day");
    const night = resolveShiftTimes(at, "night");
    const full = resolveShiftTimes(at, "full_day");
    expect(day.endTime.getTime()).toBeLessThan(night.startTime.getTime());
    expect(full.startTime.getTime()).toBe(day.startTime.getTime());
    expect(full.endTime.getTime()).toBe(night.endTime.getTime());
  });
});

describe("resolveShiftTimes: per-space overrides", () => {
  const at = new Date("2026-11-18T06:15:00Z");
  const withOverride = (override) => ({ shiftOverrides: [override] });

  it("applies an override only to its own shift", () => {
    const space = withOverride({ shift: "night", startTime: "18:30", endTime: "23:30" });
    expect(wall(resolveShiftTimes(at, "night", space).startTime)).toBe("2026-11-18 18:30");
    expect(wall(resolveShiftTimes(at, "night", space).endTime)).toBe("2026-11-18 23:30");
    expect(wall(resolveShiftTimes(at, "day", space).startTime)).toBe("2026-11-18 10:00");
    expect(wall(resolveShiftTimes(at, "full_day", space).endTime)).toBe("2026-11-18 22:00");
  });

  it("accepts the edges of the clock", () => {
    const space = withOverride({ shift: "day", startTime: "00:00", endTime: "23:59" });
    const { startTime, endTime } = resolveShiftTimes(at, "day", space);
    expect(wall(startTime)).toBe("2026-11-18 00:00");
    expect(wall(endTime)).toBe("2026-11-18 23:59");
  });

  it("accepts a one-minute shift", () => {
    const space = withOverride({ shift: "day", startTime: "09:00", endTime: "09:01" });
    const { startTime, endTime } = resolveShiftTimes(at, "day", space);
    expect(endTime - startTime).toBe(60000);
  });

  it("ignores a space without overrides, with an empty list, or none at all", () => {
    for (const space of [undefined, null, {}, { shiftOverrides: [] }, { shiftOverrides: undefined }]) {
      expect(wall(resolveShiftTimes(at, "day", space).startTime)).toBe("2026-11-18 10:00");
    }
  });

  it.each([
    ["end equals start", { shift: "day", startTime: "10:00", endTime: "10:00" }],
    ["end before start (an overnight range is not supported)", { shift: "night", startTime: "20:00", endTime: "02:00" }],
    ["24:00", { shift: "day", startTime: "10:00", endTime: "24:00" }],
    ["minutes of 60", { shift: "day", startTime: "10:60", endTime: "12:00" }],
    ["hour of 25", { shift: "day", startTime: "25:00", endTime: "26:00" }],
    ["no leading zero", { shift: "day", startTime: "9:30", endTime: "13:00" }],
    ["seconds", { shift: "day", startTime: "09:30:00", endTime: "13:00" }],
    ["text", { shift: "day", startTime: "morning", endTime: "noon" }],
    ["empty strings", { shift: "day", startTime: "", endTime: "" }],
    ["missing end", { shift: "day", startTime: "10:00" }],
    ["numbers instead of text", { shift: "day", startTime: 1000, endTime: 1500 }],
  ])("rejects an override with %s (400, never an Invalid Date)", (_label, override) => {
    expect.assertions(2);
    try {
      resolveShiftTimes(at, override.shift, withOverride(override));
    } catch (error) {
      expect(error.statusCode).toBe(400);
      expect(error.message).toMatch(/Invalid shift hours/);
    }
  });

  it.each([["breakfast"], [""], [undefined], [null], ["Day"], ["FULL_DAY"], [1]])("rejects the shift name %p", (shift) => {
    expect(() => resolveShiftTimes(at, shift)).toThrow(/Shift must be one of/);
  });

  it.each([[new Date("nope")], [undefined], ["not a date"], [NaN]])("rejects the event date %p", (date) => {
    expect(() => resolveShiftTimes(date, "day")).toThrow(/Invalid event date/);
  });
});

describe("Kathmandu calendar helpers", () => {
  it("nepalCalendarDay is the Kathmandu day at UTC midnight", () => {
    expect(nepalCalendarDay("2026-11-18T18:14:59.999Z").toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(nepalCalendarDay("2026-11-18T18:15:00.000Z").toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(nepalCalendarDay("2026-12-31T18:15:00.000Z").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("startOfNepalDay is 00:00 Kathmandu", () => {
    expect(startOfNepalDay("2026-11-18T06:15:00Z").toISOString()).toBe("2026-11-17T18:15:00.000Z");
    expect(wall(startOfNepalDay("2028-02-29T10:00:00Z"))).toBe("2028-02-29 00:00");
  });

  it.each([
    ["2026-11-18T06:15:00Z", "2026-11-18T06:15:00Z", 0],
    ["2026-11-18T18:14:59Z", "2026-11-18T18:15:00Z", 1],
    ["2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z", 1],
    ["2026-12-31T06:00:00Z", "2027-01-01T06:00:00Z", 1],
    ["2028-02-28T06:00:00Z", "2028-03-01T06:00:00Z", 2],
    ["2026-11-18T06:00:00Z", "2026-11-17T06:00:00Z", -1],
    ["2026-01-01T06:00:00Z", "2027-01-01T06:00:00Z", 365],
    ["2027-01-01T06:00:00Z", "2028-01-01T06:00:00Z", 365],
    ["2028-01-01T06:00:00Z", "2029-01-01T06:00:00Z", 366],
  ])("nepalDaysBetween(%s, %s) = %i", (from, to, expected) => {
    expect(nepalDaysBetween(new Date(from), new Date(to))).toBe(expected);
  });

  it.each([
    ["2026-10-15T06:00:00Z", "2028-10-31"],
    ["2026-01-31T06:00:00Z", "2028-01-31"],
    ["2026-02-10T06:00:00Z", "2028-02-29"], // 24 months ahead lands in a leap February
    ["2026-12-31T20:00:00Z", "2029-01-31"], // already 2027-01-01 in Kathmandu
    ["2026-12-31T06:00:00Z", "2028-12-31"],
  ])("lastBookableDay(%s) = %s (end of the month, 24 months ahead)", (now, expected) => {
    expect(lastBookableDay(new Date(now)).toISOString().slice(0, 10)).toBe(expected);
  });
});

describe("assertPreferredDate (a request needs a day of notice, counted in Kathmandu days)", () => {
  const now = new Date("2026-10-15T06:00:00Z"); // 11:45 on 15 Oct in Kathmandu
  const ok = (d, n = now) => expect(() => assertPreferredDate(d, n)).not.toThrow();
  const bad = (d, pattern, n = now) => expect(() => assertPreferredDate(d, n)).toThrow(pattern);

  it("rejects the past, today and an instant later today", () => {
    bad("2020-01-01T06:15:00Z", /Tomorrow is the earliest/);
    bad("2026-10-14T06:15:00Z", /Tomorrow is the earliest/);
    bad("2026-10-15T06:15:00Z", /Tomorrow is the earliest/);
    bad("2026-10-15T18:14:59Z", /Tomorrow is the earliest/); // 23:59 today in Kathmandu
  });

  it("accepts tomorrow from its first instant", () => {
    ok("2026-10-15T18:15:00Z"); // 00:00 tomorrow in Kathmandu
    ok("2026-10-16T06:15:00Z"); // what the date picker sends
  });

  it("follows the Kathmandu day, not the server day: at 18:15 UTC the earliest date moves on", () => {
    const before = new Date("2026-10-15T18:14:59Z"); // still the 15th in Kathmandu
    const after = new Date("2026-10-15T18:15:00Z"); // 00:00 on the 16th
    ok("2026-10-16T06:15:00Z", before);
    bad("2026-10-16T06:15:00Z", /Tomorrow/, after);
    ok("2026-10-17T06:15:00Z", after);
  });

  it("allows up to the end of the month 24 months ahead, and no further", () => {
    ok("2028-10-31T06:15:00Z");
    bad("2028-11-01T06:15:00Z", /too far ahead/);
    bad("2099-01-01T06:15:00Z", /too far ahead/);
  });

  it("rejects garbage", () => {
    bad("not a date", /Invalid date/);
    bad(undefined, /Invalid date/);
  });
});

describe("slotKeysFor", () => {
  const MIN = 60000;
  const t = (iso) => new Date(iso);

  it("gives one key per minute for a whole-minute range", () => {
    const keys = slotKeysFor("s1", t("2026-11-18T04:15:00Z"), t("2026-11-18T09:15:00Z"));
    expect(keys).toHaveLength(300);
    expect(new Set(keys).size).toBe(300);
    expect(keys[0]).toBe(`s1:${t("2026-11-18T04:15:00Z").getTime() / MIN}`);
  });

  it("two bookings that only touch share no key; one minute of overlap shares exactly one", () => {
    const a = slotKeysFor("s1", t("2026-11-18T04:15:00Z"), t("2026-11-18T09:15:00Z"));
    const touching = slotKeysFor("s1", t("2026-11-18T09:15:00Z"), t("2026-11-18T14:15:00Z"));
    const overlapping = slotKeysFor("s1", t("2026-11-18T09:14:00Z"), t("2026-11-18T14:15:00Z"));
    expect(a.filter((k) => touching.includes(k))).toHaveLength(0);
    expect(a.filter((k) => overlapping.includes(k))).toHaveLength(1);
  });

  it("is per space", () => {
    const a = slotKeysFor("s1", t("2026-11-18T04:15:00Z"), t("2026-11-18T05:15:00Z"));
    const b = slotKeysFor("s2", t("2026-11-18T04:15:00Z"), t("2026-11-18T05:15:00Z"));
    expect(a.some((k) => b.includes(k))).toBe(false);
  });

  it.each([
    ["off the minute (start)", "2026-11-18T04:15:00.500Z", "2026-11-18T09:15:00Z"],
    ["off the minute (end)", "2026-11-18T04:15:00Z", "2026-11-18T09:15:00.001Z"],
    ["empty range", "2026-11-18T04:15:00Z", "2026-11-18T04:15:00Z"],
    ["reversed range", "2026-11-18T09:15:00Z", "2026-11-18T04:15:00Z"],
    ["longer than a day", "2026-11-18T04:15:00Z", "2026-11-20T04:15:00Z"],
    ["invalid date", "nope", "2026-11-20T04:15:00Z"],
  ])("returns null (query-only protection) for %s", (_label, from, to) => {
    expect(slotKeysFor("s1", new Date(from), new Date(to))).toBeNull();
  });

  it("returns null without a space", () => {
    expect(slotKeysFor(null, t("2026-11-18T04:15:00Z"), t("2026-11-18T05:15:00Z"))).toBeNull();
  });
});
