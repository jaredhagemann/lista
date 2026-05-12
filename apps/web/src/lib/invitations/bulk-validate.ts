export type BulkInputRow = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  birthday?: string;
  gender?: string;
};

export type RowStatus = "valid" | "warning" | "error";

export type ValidatedRow = BulkInputRow & {
  status: RowStatus;
  reason?: string;
};

const VALID_ROLES = new Set(["player", "manager", "coach"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBulkRows(rows: BulkInputRow[]): ValidatedRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row.first_name?.trim() || !row.last_name?.trim() || !row.email?.trim()) {
      return { ...row, status: "error", reason: "missing_required_field" };
    }
    if (!EMAIL_RE.test(row.email.trim())) {
      return { ...row, status: "error", reason: "invalid_email" };
    }
    if (!VALID_ROLES.has(row.role?.toLowerCase?.())) {
      return { ...row, status: "error", reason: "invalid_role" };
    }
    const key = [
      row.email.trim().toLowerCase(),
      row.role.toLowerCase(),
      row.first_name.trim().toLowerCase(),
      row.last_name.trim().toLowerCase(),
    ].join("|");
    if (seen.has(key)) {
      return { ...row, status: "warning", reason: "duplicate_in_upload" };
    }
    seen.add(key);
    return { ...row, status: "valid" };
  });
}
