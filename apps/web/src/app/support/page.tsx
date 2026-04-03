export const metadata = {
  title: "Support — Lista",
};

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Support</h1>
      <p className="mb-10 text-muted-foreground">We&apos;re here to help.</p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Contact us</h2>
        <p>
          For any questions, issues, or feedback, email us at{" "}
          <a href="mailto:support@lista.team" className="underline underline-offset-4">
            support@lista.team
          </a>
          . We aim to respond within one business day.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Frequently asked questions</h2>

        <div className="space-y-6">
          <div>
            <h3 className="mb-1 font-medium">How do I join a team?</h3>
            <p className="text-muted-foreground">
              Your coach or team manager will send you an invitation by email. Follow the link in
              that email to create an account and join the team.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-medium">How do I add a child to my account?</h3>
            <p className="text-muted-foreground">
              A team admin can invite a managed profile on your behalf. Once accepted, the profile
              will appear under your account and you can manage their schedule and availability.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-medium">How do I turn off notifications?</h3>
            <p className="text-muted-foreground">
              Go to Settings in the app and adjust your notification preferences. You can control
              email and push notifications for events and chat independently.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-medium">How do I delete my account?</h3>
            <p className="text-muted-foreground">
              Email us at{" "}
              <a href="mailto:support@lista.team" className="underline underline-offset-4">
                support@lista.team
              </a>{" "}
              and we will permanently delete your account and all associated data.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-medium">Is Lista really free?</h3>
            <p className="text-muted-foreground">
              Yes. Lista is completely free with no ads, no premium tier, and no limits on roster
              size or events.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
