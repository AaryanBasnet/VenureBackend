const { resolveShiftTimes } = require("../services/shiftService");

// 10:00 in Kathmandu (UTC+5:45) is 04:15 UTC, whatever time zone the server is in.
describe("resolveShiftTimes uses Nepal time", () => {
  it("day shift 10:00-15:00 Nepal time", () => {
    const { startTime, endTime } = resolveShiftTimes(new Date("2026-11-18T06:15:00Z"), "day"); // noon in Kathmandu
    expect(startTime.toISOString()).toBe("2026-11-18T04:15:00.000Z");
    expect(endTime.toISOString()).toBe("2026-11-18T09:15:00.000Z");
  });

  it("night and full day shifts", () => {
    const night = resolveShiftTimes(new Date("2026-11-18T06:15:00Z"), "night");
    expect(night.startTime.toISOString()).toBe("2026-11-18T11:15:00.000Z"); // 17:00
    expect(night.endTime.toISOString()).toBe("2026-11-18T16:15:00.000Z"); // 22:00
    const full = resolveShiftTimes(new Date("2026-11-18T06:15:00Z"), "full_day");
    expect(full.startTime.toISOString()).toBe("2026-11-18T04:15:00.000Z");
    expect(full.endTime.toISOString()).toBe("2026-11-18T16:15:00.000Z");
  });

  it("picks the Kathmandu calendar day, not the UTC day", () => {
    // 02:00 Nepal time on 19 Nov is 20:15 UTC on 18 Nov
    const { startTime } = resolveShiftTimes(new Date("2026-11-18T20:15:00Z"), "day");
    expect(startTime.toISOString()).toBe("2026-11-19T04:15:00.000Z");
  });

  it("respects per-space overrides", () => {
    const space = { shiftOverrides: [{ shift: "day", startTime: "09:30", endTime: "13:00" }] };
    const { startTime, endTime } = resolveShiftTimes(new Date("2026-11-18T06:15:00Z"), "day", space);
    expect(startTime.toISOString()).toBe("2026-11-18T03:45:00.000Z");
    expect(endTime.toISOString()).toBe("2026-11-18T07:15:00.000Z");
  });
});
