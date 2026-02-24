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
    from: "lista <notifications@lista.app>",
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
}: {
  eventTitle: string;
  eventType: string;
  startTime: string;
  endTime: string;
  location: string | null;
  teamName: string;
  action: "created" | "updated" | "cancelled" | "reminder";
  arrivalTime?: number | null;
}) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const actionText = {
    created: "New event",
    updated: "Event updated",
    cancelled: "Event cancelled",
    reminder: "Event reminder",
  }[action];

  const arrivalLine =
    arrivalTime != null
      ? `<p style="margin: 4px 0;"><strong>Arrive by:</strong> ${new Date(start.getTime() - arrivalTime * 60 * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (${arrivalTime} min early)</p>`
      : "";

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">${actionText}: ${eventTitle}</h2>
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Team:</strong> ${teamName}</p>
        <p style="margin: 4px 0;"><strong>Type:</strong> ${eventType}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        <p style="margin: 4px 0;"><strong>Time:</strong> ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} — ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
        ${arrivalLine}
        ${location ? `<p style="margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : ""}
      </div>
      <p style="color: #666; font-size: 14px;">— lista</p>
    </div>
  `;
}

export function buildInviteEmailHtml({
  teamName,
  role,
  inviteUrl,
}: {
  teamName: string;
  role: string;
  inviteUrl: string;
}) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">You've been invited to join a team</h2>
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Team:</strong> ${teamName}</p>
        <p style="margin: 4px 0;"><strong>Role:</strong> <span style="background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 4px; font-size: 13px;">${role}</span></p>
      </div>
      <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Accept Invitation</a>
      <p style="color: #666; font-size: 13px; margin-top: 16px;">Or copy this link: ${inviteUrl}</p>
      <p style="color: #666; font-size: 14px;">— lista</p>
    </div>
  `;
}
