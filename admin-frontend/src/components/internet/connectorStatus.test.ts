import { describe, expect, it } from "vitest";
import { connectorPresence, formatAge, presenceLabel } from "./connectorStatus";

describe("connectorPresence", () => {
  it("is online under two minutes, stale before the threshold, and offline after it or when never seen", () => {
    expect(connectorPresence(0, 180)).toBe("online");
    expect(connectorPresence(119, 180)).toBe("online");
    expect(connectorPresence(120, 180)).toBe("stale");
    expect(connectorPresence(180, 180)).toBe("stale");
    expect(connectorPresence(181, 180)).toBe("offline");
    expect(connectorPresence(null, 180)).toBe("offline");
  });
});

describe("formatAge and labels", () => {
  it("formats compact ages", () => {
    expect(formatAge(9)).toBe("9s ago");
    expect(formatAge(120)).toBe("2 min ago");
    expect(formatAge(3600)).toBe("1h 0m ago");
    expect(presenceLabel("online")).toBe("Online");
    expect(presenceLabel("stale")).toBe("Stale");
    expect(presenceLabel("offline")).toBe("Offline");
  });
});
