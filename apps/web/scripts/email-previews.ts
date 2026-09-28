/**
 * Renders every email with sample data, to review and to test in real inboxes
 * (spec: docs/specs/email-upgrade.md §5).
 *
 *   pnpm email:preview
 *     Writes each email's HTML and plain text to .email-previews/, and a
 *     gallery, index.html, showing every email at phone and desktop width with
 *     its plain text. Open it in a browser. Nothing is sent.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com [--only invite] [--logo <url>] [--lista-logo <url>]
 *     Also sends each one to that address through Resend (RESEND_API_KEY),
 *     subject prefixed "[Preview]", to check Gmail, Outlook and Apple Mail.
 *     Mind the account's daily sending limit: use --only to send a few.
 *     --only takes just the samples whose name contains the text.
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
import { buildGallery, type GalleryEntry } from "@/emails/gallery";
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

  const entries: GalleryEntry[] = [];
  for (const sample of samples) {
    const { html, text } = await sample.render();
    writeFileSync(join(dir, `${sample.name}.html`), html.split(LISTA_MARK_URL).join(localMark));
    writeFileSync(join(dir, `${sample.name}.txt`), text);
    entries.push({
      group: sample.group,
      name: sample.name,
      title: sample.title,
      subject: sample.subject,
      from: sample.brand.fromName ?? "lista",
      text,
    });

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

  const gallery = join(dir, "index.html");
  writeFileSync(gallery, buildGallery(entries));
  console.log(`Wrote ${samples.length} emails${to ? `, and sent them to ${to}` : ""}. Open ${pathToFileURL(gallery).href}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
