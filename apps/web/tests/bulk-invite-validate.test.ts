/**
 * Unit tests for bulk invite CSV validation logic.
 *
 * Pure function — no mocks required.
 */

import { describe, it, expect } from "vitest";
import { validateBulkRows } from "@/lib/invitations/bulk-validate";
import type { BulkInputRow } from "@/lib/invitations/bulk-validate";

function row(overrides: Partial<BulkInputRow> = {}): BulkInputRow {
  return {
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    role: "player",
    ...overrides,
  };
}

// ── Required field validation ─────────────────────────────────────────────────

describe("validateBulkRows — required fields", () => {
  it("marks row valid when all required fields are present", () => {
    const [result] = validateBulkRows([row()]);
    expect(result.status).toBe("valid");
  });

  it("errors when first_name is blank", () => {
    const [result] = validateBulkRows([row({ first_name: "" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("missing_required_field");
  });

  it("errors when first_name is whitespace-only", () => {
    const [result] = validateBulkRows([row({ first_name: "   " })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("missing_required_field");
  });

  it("errors when last_name is blank", () => {
    const [result] = validateBulkRows([row({ last_name: "" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("missing_required_field");
  });

  it("errors when email is blank", () => {
    const [result] = validateBulkRows([row({ email: "" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("missing_required_field");
  });
});

// ── Email validation ──────────────────────────────────────────────────────────

describe("validateBulkRows — email format", () => {
  it("accepts a valid email", () => {
    const [result] = validateBulkRows([row({ email: "user@example.com" })] );
    expect(result.status).toBe("valid");
  });

  it("errors on email without @", () => {
    const [result] = validateBulkRows([row({ email: "notanemail" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("invalid_email");
  });

  it("errors on email without domain", () => {
    const [result] = validateBulkRows([row({ email: "user@" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("invalid_email");
  });

  it("errors on email with spaces", () => {
    const [result] = validateBulkRows([row({ email: "us er@example.com" })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("invalid_email");
  });
});

// ── Role validation ───────────────────────────────────────────────────────────

describe("validateBulkRows — role", () => {
  it.each(["player", "manager", "coach"])("accepts role %s", (role) => {
    const [result] = validateBulkRows([row({ role })]);
    expect(result.status).toBe("valid");
  });

  it.each(["parent", "director", "owner", "admin", ""])("errors on role %s", (role) => {
    const [result] = validateBulkRows([row({ role })]);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("invalid_role");
  });

  it("accepts role with different casing (e.g. Player)", () => {
    const [result] = validateBulkRows([row({ role: "Player" })]);
    expect(result.status).toBe("valid");
  });
});

// ── Duplicate detection ───────────────────────────────────────────────────────

describe("validateBulkRows — duplicate detection", () => {
  it("keeps first occurrence valid and marks second as warning", () => {
    const [first, second] = validateBulkRows([row(), row()]);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("warning");
    expect(second.reason).toBe("duplicate_in_upload");
  });

  it("does NOT flag same email + different role as duplicate", () => {
    const rows = [row({ role: "player" }), row({ role: "coach" })];
    const [r1, r2] = validateBulkRows(rows);
    expect(r1.status).toBe("valid");
    expect(r2.status).toBe("valid");
  });

  it("does NOT flag same email + different first_name as duplicate", () => {
    const rows = [row({ first_name: "Jane" }), row({ first_name: "John" })];
    const [r1, r2] = validateBulkRows(rows);
    expect(r1.status).toBe("valid");
    expect(r2.status).toBe("valid");
  });

  it("does NOT flag same email + different last_name as duplicate", () => {
    const rows = [row({ last_name: "Smith" }), row({ last_name: "Jones" })];
    const [r1, r2] = validateBulkRows(rows);
    expect(r1.status).toBe("valid");
    expect(r2.status).toBe("valid");
  });

  it("duplicate detection is case-insensitive", () => {
    const rows = [
      row({ email: "Jane@Example.COM", role: "PLAYER" }),
      row({ email: "jane@example.com", role: "player" }),
    ];
    const [r1, r2] = validateBulkRows(rows);
    expect(r1.status).toBe("valid");
    expect(r2.status).toBe("warning");
  });

  it("marks third occurrence as warning too", () => {
    const [r1, r2, r3] = validateBulkRows([row(), row(), row()]);
    expect(r1.status).toBe("valid");
    expect(r2.status).toBe("warning");
    expect(r3.status).toBe("warning");
  });
});

// ── Optional fields ───────────────────────────────────────────────────────────

describe("validateBulkRows — optional fields", () => {
  it("accepts row with birthday and gender", () => {
    const [result] = validateBulkRows([
      row({ birthday: "2010-04-15", gender: "female" }),
    ]);
    expect(result.status).toBe("valid");
  });

  it("accepts row without optional fields", () => {
    const [result] = validateBulkRows([row()]);
    expect(result.status).toBe("valid");
  });
});

// ── Error priority: missing field before email/role ───────────────────────────

describe("validateBulkRows — error priority", () => {
  it("reports missing_required_field before checking email format", () => {
    const [result] = validateBulkRows([row({ email: "", role: "invalid" })]);
    expect(result.reason).toBe("missing_required_field");
  });
});
