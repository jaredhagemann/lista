export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-10 text-muted-foreground">Effective date: April 3, 2026</p>

      <section className="mb-8">
        <p>
          Lista (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) operates the Lista mobile
          application and website (collectively, the &ldquo;Service&rdquo;). This policy explains what
          information we collect, how we use it, and your rights regarding that information.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Information we collect</h2>
        <p className="mb-3">We collect information you provide directly when you use the Service:</p>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li><span className="text-foreground font-medium">Account information</span> — your name and email address when you sign up.</li>
          <li><span className="text-foreground font-medium">Profile information</span> — optional details such as date of birth, gender, and profile photo.</li>
          <li><span className="text-foreground font-medium">Team information</span> — role, jersey number, and position within a team.</li>
          <li><span className="text-foreground font-medium">Managed profiles</span> — if you are a parent or guardian, you may create profiles for children in your care. These profiles are linked to your account and subject to the same protections as your own data.</li>
          <li><span className="text-foreground font-medium">Content you create</span> — chat messages, event responses, and availability submissions.</li>
          <li><span className="text-foreground font-medium">Device information</span> — push notification tokens to deliver notifications to your device.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">How we use your information</h2>
        <p className="mb-3">We use the information we collect solely to provide and operate the Service:</p>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li>Creating and managing your account and team memberships.</li>
          <li>Displaying roster, schedule, and availability information to your teammates.</li>
          <li>Sending event reminders and notifications you have opted into.</li>
          <li>Delivering chat messages between team members in real time.</li>
        </ul>
        <p className="mt-3">
          We do not sell your personal information. We do not use your data for advertising.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Information shared with teammates</h2>
        <p>
          Lista is a team communication platform. Your name, profile photo, role, jersey number,
          and position are visible to other members of teams you belong to. Chat messages you send
          are visible to the participants of that channel. Your email address is visible to team
          admins (coaches, managers, and directors) and to users who manage your profile.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Third-party services</h2>
        <p className="mb-3">We use a small number of third-party services to operate the platform:</p>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li><span className="text-foreground font-medium">Supabase</span> — database, authentication, and file storage. Your data is stored on Supabase infrastructure.</li>
          <li><span className="text-foreground font-medium">Resend</span> — transactional email delivery (event notifications and reminders).</li>
          <li><span className="text-foreground font-medium">Expo / Apple Push Notification Service</span> — delivery of push notifications to iOS devices.</li>
        </ul>
        <p className="mt-3">
          These services are used only to operate Lista and are not permitted to use your data for
          their own purposes.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Data retention and deletion</h2>
        <p>
          Your data is retained for as long as your account is active. You may request deletion of
          your account and associated data at any time by contacting us at the address below. When
          a team is deleted by its owner, all associated data — including events, availability,
          messages, and memberships — is permanently removed.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Children&apos;s privacy</h2>
        <p>
          Lista supports managed profiles for child athletes, created and controlled by a parent
          or guardian. We do not knowingly collect personal information directly from children
          under 13. Managed profiles are created by and remain under the control of the
          responsible adult&apos;s account.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Changes to this policy</h2>
        <p>
          We may update this policy from time to time. When we do, we will revise the effective
          date at the top of this page. Continued use of the Service after changes are posted
          constitutes your acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Contact</h2>
        <p>
          If you have questions or requests regarding this policy, please contact us at{" "}
          <a href="mailto:privacy@lista.team" className="underline underline-offset-4">
            privacy@lista.team
          </a>
          .
        </p>
      </section>
    </div>
  );
}
