/**
 * Renders every email with sample data, to look at and to test in real inboxes
 * (spec: docs/specs/email-upgrade.md §5).
 *
 *   pnpm email:preview
 *     Writes each email's HTML and plain text to .email-previews/, with an
 *     index.html linking them. Open it in a browser.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com [--only invite] [--logo <url>] [--lista-logo <url>]
 *     Also sends each one to that address through Resend (RESEND_API_KEY),
 *     subject prefixed "[Preview]", to check Gmail, Outlook and Apple Mail.
 *     --only sends just the samples whose name contains the text.
 *     --logo uses a real club logo in place of the stand-in image.
 *     --lista-logo serves lista's mark from elsewhere, e.g. a preview deployment's
 *       /email/lista-mark.png, before the production copy exists.
 *
 * The files written locally show lista's mark from public/email, so they look
 * right before it is deployed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { emailSamples, sampleClub } from "@/emails/samples";
import { LISTA_MARK_URL } from "@/emails/brand";
import { sendEmail } from "@/lib/notifications/email";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("send");
  const only = arg("only");
  const listaLogo = arg("lista-logo");
  const club = sampleClub(arg("logo"));
  const samples = emailSamples(club).filter((sample) => !only || sample.name.includes(only));

  const dir = join(process.cwd(), ".email-previews");
  mkdirSync(dir, { recursive: true });
  const localMark = pathToFileURL(join(process.cwd(), "public", "email", "lista-mark.png")).href;

  const links: string[] = [];
  for (const sample of samples) {
    const { html, text } = await sample.render();
    writeFileSync(join(dir, `${sample.name}.html`), html.split(LISTA_MARK_URL).join(localMark));
    writeFileSync(join(dir, `${sample.name}.txt`), text);
    links.push(
      `<li><a href="${sample.name}.html">${sample.name}</a> · <a href="${sample.name}.txt">text</a> — ${sample.subject}</li>`
    );

    if (to) {
      await sendEmail({
        to,
        subject: `[Preview] ${sample.subject}`,
        html: listaLogo ? html.split(LISTA_MARK_URL).join(listaLogo) : html,
        text,
        brandName: sample.brand.fromName,
      });
      console.log(`Sent ${sample.name}`);
    }
  }

  writeFileSync(
    join(dir, "index.html"),
    `<!DOCTYPE html><meta charset="utf-8"><title>Email previews</title><h1>Email previews</h1><ul>${links.join("")}</ul>`
  );
  console.log(`Wrote ${samples.length} emails to ${dir}${to ? `, and sent them to ${to}` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
