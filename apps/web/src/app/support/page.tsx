export const metadata = {
  title: "Support",
};

const faqs = [
  {
    q: "How do I delete my account?",
    a: "You can delete your account directly in the app. On iOS, go to Settings → Delete Account. On the web, go to Settings → Account → Delete Account. Note: if you own a team, you must transfer or delete that team first. Deletion is permanent and cannot be undone.",
  },
  {
    q: "How do I join a team?",
    a: "Ask your coach or team manager to send you an invitation link. Tapping the link will guide you through creating an account (or signing in) and joining the team automatically.",
  },
  {
    q: "How do I add a player I manage (e.g., my child)?",
    a: "In Settings → Managed Players, tap 'Add Player'. You can create a profile for any player you manage. Their profile will appear on the team roster and you can submit availability on their behalf.",
  },
  {
    q: "Why am I not receiving push notifications?",
    a: "Make sure notifications are enabled for Lista in your device's system settings. You can also check your in-app notification preferences under Settings → Notifications.",
  },
  {
    q: "How do I transfer team ownership?",
    a: "Go to Settings → Team → Transfer Ownership. You can hand off ownership to any coach or manager on the team who has an account.",
  },
  {
    q: "How do I contact support?",
    a: "Email us at support@lista.team and we'll get back to you as soon as we can.",
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Support</h1>
      <p className="mb-10 text-muted-foreground">
        Frequently asked questions. Still stuck?{" "}
        <a
          href="mailto:support@lista.team"
          className="underline underline-offset-4"
        >
          Email us
        </a>
        .
      </p>

      <div className="space-y-8">
        {faqs.map(({ q, a }) => (
          <section key={q}>
            <h2 className="mb-2 font-semibold">{q}</h2>
            <p className="text-muted-foreground">{a}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
