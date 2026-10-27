/**
 * Where a team notice's footer links (team-notification-controls §3.4, D11):
 * the notifications tab of Settings, and the same tab with the team to
 * highlight for "Mute [Team]". Both need the reader signed in; a one-click
 * unsubscribe is a separate change (D11).
 */
export type NotificationSettingsLinks = { manageUrl: string; muteUrl: string };

export function notificationSettingsLinks(appUrl: string, teamId: string): NotificationSettingsLinks {
  const manageUrl = `${appUrl}/dashboard/settings?tab=notifications`;
  return { manageUrl, muteUrl: `${manageUrl}&team=${encodeURIComponent(teamId)}` };
}
