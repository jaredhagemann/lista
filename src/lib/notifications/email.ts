import { Resend } from "resend";

let resend: Resend | null = null;

function getResend() {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const { data, error } = await getResend().emails.send({
    from: "lista <notifications@lista.team>",
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send email:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}

export function buildEventEmailHtml({
  eventTitle,
  eventType,
  startTime,
  endTime,
  location,
  teamName,
  action,
  arrivalTime,
  eventUrl,
}: {
  eventTitle: string;
  eventType: string;
  startTime: string;
  endTime: string;
  location: string | null;
  teamName: string;
  action: "created" | "updated" | "cancelled" | "reminder";
  arrivalTime?: number | null;
  eventUrl?: string;
}) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const actionMeta = {
    created:  { label: "New Event",      color: "#16a34a", bg: "#dcfce7" },
    updated:  { label: "Event Updated",  color: "#b45309", bg: "#fef3c7" },
    cancelled:{ label: "Event Cancelled",color: "#dc2626", bg: "#fee2e2" },
    reminder: { label: "Event Reminder", color: "#2563eb", bg: "#dbeafe" },
  }[action];

  const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeStr = `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  const arrivalTime_ = arrivalTime != null
    ? new Date(start.getTime() - arrivalTime * 60 * 1000)
        .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  function detailRow(label: string, value: string) {
    return `
      <tr>
        <td style="padding: 8px 0; font-size: 14px; color: #6b7280; white-space: nowrap; padding-right: 16px; border-bottom: 1px solid #f3f4f6;">${label}</td>
        <td style="padding: 8px 0; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${value}</td>
      </tr>`;
  }

  const ctaButton = eventUrl ? `
    <table cellpadding="0" cellspacing="0" style="margin-top: 32px; margin-bottom: 8px;">
      <tr>
        <td align="center" style="background-color: #2563eb; border-radius: 8px;">
          <a href="${eventUrl}"
             style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
            View event
          </a>
        </td>
      </tr>
    </table>` : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">

              <!-- Logo / brand -->
              <tr>
                <td align="center" style="padding-bottom: 24px;">
                  <span style="font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">lista</span>
                </td>
              </tr>

              <!-- Card -->
              <tr>
                <td style="background: #ffffff; border-radius: 12px; padding: 40px 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                  <!-- Action badge -->
                  <p style="margin: 0 0 16px;">
                    <span style="display: inline-block; background: ${actionMeta.bg}; color: ${actionMeta.color}; padding: 3px 12px; border-radius: 99px; font-size: 13px; font-weight: 600;">
                      ${actionMeta.label}
                    </span>
                  </p>

                  <!-- Event title -->
                  <h1 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #111827; line-height: 1.3;">
                    ${eventTitle}
                  </h1>

                  <!-- Details table -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${detailRow("Team", teamName)}
                    ${detailRow("Type", eventType.charAt(0).toUpperCase() + eventType.slice(1))}
                    ${detailRow("Date", dateStr)}
                    ${detailRow("Time", timeStr)}
                    ${arrivalTime_ ? detailRow("Arrive by", `${arrivalTime_} <span style="color:#6b7280;">(${arrivalTime} min early)</span>`) : ""}
                    ${location ? detailRow("Location", location) : ""}
                  </table>

                  ${ctaButton}

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 24px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                    You received this email because you're a member of ${teamName} on Lista.<br>
                    You can manage your notification preferences in your account settings.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export function buildSeriesUpdateEmailHtml({
  eventTitle,
  teamName,
  changes,
}: {
  eventTitle: string;
  teamName: string;
  changes: FieldChange[];
}) {
  const changeRows = changes
    .map(
      (c) => `
      <tr>
        <td style="padding: 10px 12px; font-size: 14px; font-weight: 500; color: #374151; border-bottom: 1px solid #f3f4f6; white-space: nowrap;">${c.field}</td>
        <td style="padding: 10px 12px; font-size: 14px; color: #9ca3af; border-bottom: 1px solid #f3f4f6; text-decoration: line-through;">${c.before}</td>
        <td style="padding: 10px 12px; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${c.after}</td>
      </tr>`
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">

              <!-- Logo / brand -->
              <tr>
                <td align="center" style="padding-bottom: 24px;">
                  <span style="font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">lista</span>
                </td>
              </tr>

              <!-- Card -->
              <tr>
                <td style="background: #ffffff; border-radius: 12px; padding: 40px 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                  <!-- Action badge -->
                  <p style="margin: 0 0 16px;">
                    <span style="display: inline-block; background: #fef3c7; color: #b45309; padding: 3px 12px; border-radius: 99px; font-size: 13px; font-weight: 600;">
                      Schedule Updated
                    </span>
                  </p>

                  <!-- Heading -->
                  <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #111827; line-height: 1.3;">
                    ${eventTitle}
                  </h1>
                  <p style="margin: 0 0 28px; font-size: 14px; color: #6b7280;">${teamName}</p>

                  <!-- Changes table -->
                  ${changes.length > 0 ? `
                  <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <thead>
                      <tr style="background: #f9fafb;">
                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb;">Field</th>
                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb;">Before</th>
                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb;">After</th>
                      </tr>
                    </thead>
                    <tbody>${changeRows}</tbody>
                  </table>
                  ` : `
                  <p style="font-size: 15px; color: #374151;">The recurring schedule for this event has been updated.</p>
                  `}

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 24px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                    You received this email because you're a member of ${teamName} on Lista.<br>
                    You can manage your notification preferences in your account settings.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function buildConfirmationEmailHtml({
  confirmUrl,
  firstName,
}: {
  confirmUrl: string;
  firstName?: string;
}) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">

              <!-- Logo / brand -->
              <tr>
                <td align="center" style="padding-bottom: 24px;">
                  <span style="font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">lista</span>
                </td>
              </tr>

              <!-- Card -->
              <tr>
                <td style="background: #ffffff; border-radius: 12px; padding: 40px 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                  <!-- Heading -->
                  <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #111827; line-height: 1.3;">
                    Confirm your account
                  </h1>

                  <!-- Body copy -->
                  <p style="margin: 0 0 8px; font-size: 15px; color: #374151; line-height: 1.6;">
                    ${greeting}
                  </p>
                  <p style="margin: 0 0 32px; font-size: 15px; color: #374151; line-height: 1.6;">
                    Thanks for signing up for Lista! Click the button below to confirm your email address and activate your account.
                  </p>

                  <!-- CTA button -->
                  <table cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
                    <tr>
                      <td align="center" style="background-color: #2563eb; border-radius: 8px;">
                        <a href="${confirmUrl}"
                           style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                          Confirm my account
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Fallback link -->
                  <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${confirmUrl}" style="color: #6b7280; word-break: break-all;">${confirmUrl}</a>
                  </p>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 24px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                    You received this email because you created an account on Lista.<br>
                    If you didn't sign up, you can safely ignore this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function buildInviteEmailHtml({
  teamName,
  inviterName,
  role,
  inviteUrl,
}: {
  teamName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">

              <!-- Logo / brand -->
              <tr>
                <td align="center" style="padding-bottom: 24px;">
                  <span style="font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">lista</span>
                </td>
              </tr>

              <!-- Card -->
              <tr>
                <td style="background: #ffffff; border-radius: 12px; padding: 40px 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                  <!-- Heading -->
                  <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #111827; line-height: 1.3;">
                    You've been invited to join a team on Lista!
                  </h1>

                  <!-- Role badge -->
                  <p style="margin: 0 0 20px;">
                    <span style="display: inline-block; background: #e0e7ff; color: #3730a3; padding: 3px 12px; border-radius: 99px; font-size: 13px; font-weight: 600; text-transform: capitalize;">${role}</span>
                  </p>

                  <!-- Body copy -->
                  <p style="margin: 0 0 24px; font-size: 15px; color: #374151; line-height: 1.6;">
                    <strong>${inviterName}</strong> is using Lista to organize <strong>${teamName}</strong> and simplify communication.
                    Accept your invite and activate your account to do things like:
                  </p>

                  <!-- Feature list -->
                  <table cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
                    <tr>
                      <td style="padding: 5px 0; font-size: 15px; color: #374151;">📅&nbsp; View the team schedule</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 0; font-size: 15px; color: #374151;">✅&nbsp; Share your availability</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 0; font-size: 15px; color: #374151;">💬&nbsp; Stay in touch with your team</td>
                    </tr>
                  </table>

                  <!-- CTA button -->
                  <table cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
                    <tr>
                      <td align="center" style="background-color: #2563eb; border-radius: 8px;">
                        <a href="${inviteUrl}"
                           style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                          Accept invitation
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Fallback link -->
                  <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${inviteUrl}" style="color: #6b7280; word-break: break-all;">${inviteUrl}</a>
                  </p>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 24px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                    You received this email because someone invited you to a team on Lista.<br>
                    If you weren't expecting this, you can safely ignore it.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
