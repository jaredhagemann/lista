/**
 * The preview gallery page (scripts/email-previews.ts): every email on one page,
 * grouped, each shown at phone and desktop width with its plain-text part.
 * The emails themselves are separate files beside it, framed by name.
 */

export type GalleryEntry = {
  group: string;
  name: string;
  title: string;
  subject: string;
  from: string;
  text: string;
};

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; background: #e5e7eb; }
  nav { position: fixed; inset: 0 auto 0 0; width: 250px; overflow-y: auto; padding: 20px 16px; background: #fff; border-right: 1px solid #d1d5db; font-size: 13px; }
  nav h1 { font-size: 16px; margin: 0 0 4px; }
  nav p { margin: 0 0 16px; color: #6b7280; }
  nav h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin: 16px 0 6px; }
  nav h2 a { color: inherit; text-decoration: none; }
  nav a { display: block; color: #1f2937; text-decoration: none; padding: 3px 0; }
  nav a:hover { color: #2563eb; }
  main { margin-left: 250px; padding: 24px 32px 80px; }
  .group { font-size: 22px; margin: 40px 0 8px; }
  .group:first-child { margin-top: 0; }
  section { background: #fff; border-radius: 12px; padding: 20px 24px; margin: 16px 0 28px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  section h3 { margin: 0 0 6px; font-size: 17px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0 0 16px; font-size: 13px; }
  dt { color: #6b7280; }
  dd { margin: 0; }
  .frames { display: flex; gap: 20px; align-items: flex-start; overflow-x: auto; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
  iframe { border: 1px solid #d1d5db; border-radius: 8px; background: #fff; height: 820px; }
  details { margin-top: 14px; font-size: 13px; }
  summary { cursor: pointer; color: #2563eb; }
  pre { white-space: pre-wrap; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; max-width: 720px; }
`;

export function buildGallery(entries: GalleryEntry[]): string {
  const groups = [...new Set(entries.map((e) => e.group))];

  const nav = groups
    .map(
      (group) =>
        `<h2><a href="#${slug(group)}">${escape(group)}</a></h2>` +
        entries
          .filter((e) => e.group === group)
          .map((e) => `<a href="#${e.name}">${escape(e.title)}</a>`)
          .join("")
    )
    .join("");

  const sections = groups
    .map(
      (group) =>
        `<h2 class="group" id="${slug(group)}">${escape(group)}</h2>` +
        entries
          .filter((e) => e.group === group)
          .map(
            (e) => `
      <section id="${e.name}">
        <h3>${escape(e.title)}</h3>
        <dl>
          <dt>Subject</dt><dd>${escape(e.subject)}</dd>
          <dt>From</dt><dd>${escape(e.from)} &lt;notifications@lista.team&gt;</dd>
          <dt>File</dt><dd><a href="${e.name}.html">${e.name}.html</a></dd>
        </dl>
        <div class="frames">
          <figure><figcaption>Phone · 390px</figcaption><iframe src="${e.name}.html" width="390" loading="lazy" title="${escape(e.title)} at phone width"></iframe></figure>
          <figure><figcaption>Desktop · 720px</figcaption><iframe src="${e.name}.html" width="720" loading="lazy" title="${escape(e.title)} at desktop width"></iframe></figure>
        </div>
        <details><summary>Plain text</summary><pre>${escape(e.text)}</pre></details>
      </section>`
          )
          .join("")
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>lista email previews</title><style>${STYLE}</style></head>
<body>
  <nav>
    <h1>Email previews</h1>
    <p>${entries.length} emails with sample data. A browser is more forgiving than a mail client: check real inboxes too.</p>
    ${nav}
  </nav>
  <main>${sections}</main>
</body>
</html>
`;
}
