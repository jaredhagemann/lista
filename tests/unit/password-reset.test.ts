import { describe, it, expect } from "vitest";
import { validatePasswordMatch } from "@/lib/auth/password-reset";

describe("validatePasswordMatch", () => {
  it("returns null when passwords match and are >= 6 chars", () => {
    expect(validatePasswordMatch("abc123", "abc123")).toBeNull();
  });

  it('returns "Passwords do not match" when they differ', () => {
    expect(validatePasswordMatch("abc123", "abc456")).toBe(
      "Passwords do not match"
    );
  });

  it('returns "Password must be at least 6 characters" when too short', () => {
    expect(validatePasswordMatch("short", "short")).toBe(
      "Password must be at least 6 characters"
    );
  });

  it("length error takes priority over mismatch error", () => {
    expect(validatePasswordMatch("short", "other")).toBe(
      "Password must be at least 6 characters"
    );
  });
});
