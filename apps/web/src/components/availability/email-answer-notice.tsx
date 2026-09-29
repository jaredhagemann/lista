"use client";

import { useEffect } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { describeEmailAnswer, type EmailAnswerNotice as Notice } from "@/lib/availability/email-answer";

/**
 * What happened to an answer given from an email link (spec: email-upgrade
 * §4.7, D7). Once shown, the answer comes out of the address, so a reload
 * can't overwrite a change made on the page since. It's replaced in the
 * browser's history, not navigated to: a navigation would render the page
 * again without the answer, and this notice with it (PR #96 review).
 */
export function EmailAnswerNotice({ notice, cleanPath }: { notice: Notice; cleanPath: string }) {
  useEffect(() => {
    window.history.replaceState(null, "", cleanPath);
  }, [cleanPath]);

  const recorded = notice.kind === "recorded";
  const Icon = recorded ? CheckCircle2 : Info;
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${
        recorded
          ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{describeEmailAnswer(notice)}</span>
    </div>
  );
}
