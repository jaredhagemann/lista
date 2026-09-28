import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  render,
} from "@react-email/components";
import { buttonTextColor, type EmailBrand } from "@/emails/brand";

/**
 * The one layout every email is built from (spec: docs/specs/email-upgrade.md §4.1):
 * a gray page, a 560px white card under the brand's header, and a footer. The
 * parts below are the only building blocks templates use, so a change to the
 * look is made here once. User text goes in as JSX children, which React
 * escapes, never as HTML.
 */

export type RenderedEmail = { html: string; text: string };

/** Renders a template to its HTML and plain-text parts. */
export async function renderEmail(email: ReactNode): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(email),
    // Headings keep their case in plain text (the converter shouts them by default).
    render(email, {
      plainText: true,
      htmlToTextOptions: { selectors: [{ selector: "h1", options: { uppercase: false } }] },
    }),
  ]);
  return { html, text };
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function EmailLayout({
  brand,
  preview,
  footer,
  children,
}: {
  brand: EmailBrand;
  /** The line an inbox shows under the subject. */
  preview: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        {/* The design is light-only; ask clients not to invert it. */}
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#f4f4f5", fontFamily: FONT }}>
        <Container style={{ maxWidth: "560px", width: "100%", padding: "40px 16px" }}>
          <Section style={{ textAlign: "center", paddingBottom: "24px" }}>
            <BrandMark brand={brand} />
          </Section>
          <Section
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              padding: "40px 40px 32px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            {children}
          </Section>
          <Section style={{ textAlign: "center", paddingTop: "24px" }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "18px", color: "#9ca3af" }}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** The header: the brand's logo, or its name as a wordmark. */
function BrandMark({ brand }: { brand: EmailBrand }) {
  if (brand.logoUrl) {
    return (
      <Img
        src={brand.logoUrl}
        alt={brand.name}
        height="48"
        style={{ display: "inline-block", maxHeight: "48px", maxWidth: "200px", width: "auto", objectFit: "contain" }}
      />
    );
  }
  const wordmark = brand.fromName ? brand.name : "lista";
  return (
    <Text style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px" }}>
      {wordmark}
    </Text>
  );
}

export function EmailHeading({ children, spaced = true }: { children: ReactNode; spaced?: boolean }) {
  return (
    <Heading
      as="h1"
      style={{
        margin: spaced ? "0 0 16px" : "0 0 8px",
        fontSize: "22px",
        fontWeight: 700,
        color: "#111827",
        lineHeight: 1.3,
      }}
    >
      {children}
    </Heading>
  );
}

export function EmailText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text style={{ margin: "0 0 16px", fontSize: "15px", lineHeight: 1.6, color: muted ? "#6b7280" : "#374151" }}>
      {children}
    </Text>
  );
}

export function SmallPrint({ children }: { children: ReactNode }) {
  return <Text style={{ margin: "16px 0 0", fontSize: "13px", lineHeight: 1.5, color: "#9ca3af" }}>{children}</Text>;
}

const BADGE_TONES = {
  green: { color: "#16a34a", background: "#dcfce7" },
  amber: { color: "#b45309", background: "#fef3c7" },
  red: { color: "#dc2626", background: "#fee2e2" },
  blue: { color: "#2563eb", background: "#dbeafe" },
  indigo: { color: "#3730a3", background: "#e0e7ff" },
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

/** A status pill: "New Event", "Event Cancelled", a role. */
export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  const { color, background } = BADGE_TONES[tone];
  return (
    <Text style={{ margin: "0 0 16px" }}>
      <span
        style={{
          display: "inline-block",
          backgroundColor: background,
          color,
          padding: "3px 12px",
          borderRadius: "99px",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </Text>
  );
}

/** Label and value rows: an event's date, time, location. */
export function DetailTable({ rows }: { rows: Array<[label: string, value: ReactNode]> }) {
  const cell = { padding: "8px 0", fontSize: "14px", borderBottom: "1px solid #f3f4f6" };
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ ...cell, color: "#6b7280", whiteSpace: "nowrap", paddingRight: "16px" }}>{label}</td>
            <td style={{ ...cell, color: "#111827" }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Before and after, for a changed schedule. */
export function ChangeTable({ changes }: { changes: Array<{ field: string; before: string; after: string }> }) {
  const head = {
    padding: "10px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    textAlign: "left" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e5e7eb",
  };
  const cell = { padding: "10px 12px", fontSize: "14px", borderBottom: "1px solid #f3f4f6" };
  return (
    <table
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ border: "1px solid #e5e7eb", borderRadius: "8px", borderCollapse: "separate" }}
    >
      <thead>
        <tr style={{ backgroundColor: "#f9fafb" }}>
          <th style={head}>Field</th>
          <th style={head}>Before</th>
          <th style={head}>After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change, i) => (
          <tr key={i}>
            <td style={{ ...cell, fontWeight: 500, color: "#374151", whiteSpace: "nowrap" }}>{change.field}</td>
            <td style={{ ...cell, color: "#9ca3af", textDecoration: "line-through" }}>{change.before}</td>
            <td style={{ ...cell, color: "#111827" }}>{change.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The call to action, in the brand's color unless the email calls for danger. */
export function EmailButton({
  href,
  children,
  brand,
  danger = false,
}: {
  href: string;
  children: ReactNode;
  brand: EmailBrand;
  danger?: boolean;
}) {
  const background = danger ? "#dc2626" : brand.color;
  return (
    <Section style={{ margin: "24px 0 8px" }}>
      <Button
        href={href}
        style={{
          display: "inline-block",
          backgroundColor: background,
          color: buttonTextColor(background),
          padding: "14px 32px",
          fontSize: "15px",
          fontWeight: 600,
          textDecoration: "none",
          borderRadius: "8px",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** The link spelled out, for when the button doesn't work. */
export function FallbackLink({ href }: { href: string }) {
  return (
    <SmallPrint>
      If the button doesn&apos;t work, copy and paste this link into your browser:
      <br />
      <Link href={href} style={{ color: "#6b7280", wordBreak: "break-all" }}>
        {href}
      </Link>
    </SmallPrint>
  );
}

/** Text with bold spans, as data: "Hi ", { strong: "Ava" }. Never HTML. */
export type RichText = string | Array<string | { strong: string }>;

export function Rich({ text }: { text: RichText }) {
  if (typeof text === "string") return <>{text}</>;
  return (
    <>
      {text.map((part, i) => (typeof part === "string" ? part : <strong key={i}>{part.strong}</strong>))}
    </>
  );
}
