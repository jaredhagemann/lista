import { EmailHeading, EmailLayout, EmailText, SmallPrint, StatusBadge, renderEmail } from "@/emails/layout";
import { LISTA_BRAND } from "@/emails/brand";

/**
 * The team a member belonged to was deleted. Sent after the delete, when the
 * team and its club link are gone, so it carries lista's brand.
 */
export function TeamDeletionEmail({ teamName }: { teamName: string }) {
  return (
    <EmailLayout brand={LISTA_BRAND} preview={`${teamName} has been deleted`} footer="lista · team management made simple">
      <StatusBadge label="Team Deleted" tone="red" />
      <EmailHeading spaced={false}>{`${teamName} has been deleted`}</EmailHeading>
      <EmailText muted>
        The team owner has permanently deleted <strong>{teamName}</strong>. All team data — including members,
        events, and chat history — has been removed. No further action is required.
      </EmailText>
      <SmallPrint>
        This is an automated notification from lista. If you have questions, contact your team owner directly.
      </SmallPrint>
    </EmailLayout>
  );
}

export function renderTeamDeletionEmail(props: { teamName: string }) {
  return renderEmail(<TeamDeletionEmail {...props} />);
}
