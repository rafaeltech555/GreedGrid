import { describe, expect, it } from "vitest";
import { formatBytes, formatMemPair, formatUptime, pushHistory } from "./format";

describe("formatBytes", () => {
  it("scales to binary units", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(2048)).toBe("2K");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5M");
    expect(formatBytes(Math.round(6.2 * 1024 ** 3))).toBe("6.2G");
  });
});

describe("formatMemPair", () => {
  it("renders used/total in the larger unit", () => {
    expect(formatMemPair(Math.round(6.2 * 1024 ** 3), 16 * 1024 ** 3)).toBe("6.2/16.0G");
  });
});

describe("formatUptime", () => {
  it("formats hh:mm under a day and prefixes days over a day", () => {
    expect(formatUptime(3661)).toBe("01:01");
    expect(formatUptime(86400)).toBe("1d 00:00");
    expect(formatUptime(90061)).toBe("1d 01:01");
  });
});

describe("pushHistory", () => {
  it("appends and drops the oldest past cap without mutating input", () => {
    const a = [1, 2, 3];
    expect(pushHistory(a, 4, 5)).toEqual([1, 2, 3, 4]);
    expect(pushHistory([1, 2, 3, 4, 5], 6, 5)).toEqual([2, 3, 4, 5, 6]);
    expect(a).toEqual([1, 2, 3]); // input untouched
  });
});
