"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Download, Upload, AlertTriangle } from "lucide-react";
import { validateBulkRows } from "@/lib/invitations/bulk-validate";
import type { ValidatedRow, BulkInputRow } from "@/lib/invitations/bulk-validate";

interface BulkInviteModalProps {
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "result";

type SendResult = {
  sent: number;
  skipped: number;
  failed: number;
  results: { email: string; status: "sent" | "failed"; error?: string }[];
};

const TEMPLATE_CSV =
  "first_name,last_name,email,role,birthday,gender\nJane,Smith,jane@example.com,player,2010-04-15,female";

function parseCsv(text: string): BulkInputRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i]?.trim() ?? "";
    });
    return {
      first_name: obj.first_name ?? "",
      last_name: obj.last_name ?? "",
      email: obj.email ?? "",
      role: obj.role ?? "",
      birthday: obj.birthday || undefined,
      gender: obj.gender || undefined,
    };
  });
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function StatusBadge({ row }: { row: ValidatedRow }) {
  if (row.status === "valid") {
    return (
      <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Valid
      </Badge>
    );
  }
  if (row.status === "warning") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
        <AlertTriangle className="h-3 w-3" />
        Duplicate — skipped
      </Badge>
    );
  }
  const errorLabels: Record<string, string> = {
    missing_required_field: "Missing required field",
    invalid_email: "Invalid email",
    invalid_role: "Invalid role",
  };
  return (
    <Badge variant="outline" className="gap-1 border-destructive text-destructive">
      <AlertCircle className="h-3 w-3" />
      {errorLabels[row.reason ?? ""] ?? "Error"}
    </Badge>
  );
}

export function BulkInviteModal({ teamId, open, onOpenChange }: BulkInviteModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const hasBirthday = rows.some((r) => r.birthday);

  const validCount = rows.filter((r) => r.status === "valid").length;
  const warnCount = rows.filter((r) => r.status === "warning").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const hasErrors = errorCount > 0;

  function reset() {
    setStep("upload");
    setRows([]);
    setResult(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setFileError("Please select a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setFileError("No data rows found. Check that the file has a header row and at least one data row.");
        return;
      }
      if (parsed.length > 100) {
        setFileError("Maximum 100 rows per upload. Please split the file.");
        return;
      }
      setRows(validateBulkRows(parsed));
      setStep("preview");
    };
    reader.readAsText(file);
  }

  async function handleSend() {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/invitations/bulk-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          rows: rows
            .filter((r) => r.status === "valid")
            .map(({ first_name, last_name, email, role, birthday, gender }) => ({
              first_name,
              last_name,
              email,
              role,
              birthday,
              gender,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to send invitations");
        return;
      }
      setResult(data);
      setStep("result");
      router.refresh();
    } catch {
      toast.error("Failed to send invitations");
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-invite-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${step === "upload" ? "max-w-lg" : "w-fit max-w-[90vw] sm:w-fit sm:max-w-[90vw]"}`}>
        <DialogHeader>
          <DialogTitle>Bulk invite</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV with columns: <code>first_name</code>, <code>last_name</code>,{" "}
              <code>email</code>, <code>role</code> (player / manager / coach). Optional:{" "}
              <code>birthday</code> (YYYY-MM-DD), <code>gender</code>. Maximum 100 rows.
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download template
            </Button>
            {fileError && (
              <p className="text-sm text-destructive">{fileError}</p>
            )}
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 cursor-pointer hover:bg-accent transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click to select a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">.csv files only</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {validCount} will be sent
              {warnCount > 0 ? `, ${warnCount} will be skipped` : ""}
              {errorCount > 0 ? `, ${errorCount} have errors` : ""}
            </p>
            {hasErrors && (
              <p className="text-sm text-destructive">
                Fix errors by editing the CSV and re-uploading before sending.
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">First name</th>
                    <th className="px-3 py-2 text-left font-medium">Last name</th>
                    <th className="px-3 py-2 text-left font-medium">Email</th>
                    <th className="px-3 py-2 text-left font-medium">Role</th>
                    {hasBirthday && (
                      <th className="px-3 py-2 text-left font-medium">Birthday</th>
                    )}
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{row.first_name}</td>
                      <td className="px-3 py-2">{row.last_name}</td>
                      <td className="px-3 py-2">{row.email}</td>
                      <td className="px-3 py-2 capitalize">{row.role}</td>
                      {hasBirthday && (
                        <td className="px-3 py-2">{row.birthday ?? ""}</td>
                      )}
                      <td className="px-3 py-2">
                        <StatusBadge row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button onClick={handleSend} disabled={hasErrors || validCount === 0 || isSubmitting}>
                {isSubmitting ? "Sending…" : `Send ${validCount} invite${validCount !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4">
            <div className="flex gap-4 text-sm">
              <span className="text-green-600 font-medium">{result.sent} sent</span>
              {result.skipped > 0 && (
                <span className="text-muted-foreground">{result.skipped} skipped</span>
              )}
              {result.failed > 0 && (
                <span className="text-destructive font-medium">{result.failed} failed</span>
              )}
            </div>
            {result.failed > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Failed:</p>
                {result.results
                  .filter((r) => r.status === "failed")
                  .map((r, i) => (
                    <p key={i} className="text-sm text-destructive">
                      {r.email}{r.error ? ` — ${r.error}` : ""}
                    </p>
                  ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
