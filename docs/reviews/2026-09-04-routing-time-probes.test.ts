// Audit probes: these assert observed defects, NOT desired product behavior.
// No external requests, emails, or application data writes.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://audit.invalid');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'audit-placeholder');
// Supabase's no-cookie getUser path has no session to validate. Prevent network
// access regardless, so these probes cannot reach a configured external service.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Audit probe attempted network access'); }));
import { updateSession } from '@/lib/supabase/middleware';
import { buildRRule, expandRecurrenceFromLocalString } from '@/lib/utils/rrule';
import { buildEventEmailHtml } from '@/lib/notifications/email';

describe('Readiness audit: observed current behavior', () => {
  it.each(['reminders', 'trial-expiration', 'subdomain-quarantine'])(
    'cron %s is redirected to login despite its Bearer header', async (name) => {
      const request = new NextRequest(`https://lista.team/api/cron/${name}`, {
        headers: { authorization: 'Bearer audit-placeholder' },
      });
      const response = await updateSession(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://lista.team/login');
    },
  );
  it('a weekly recurrence ending on its second practice date drops that practice', () => {
    const rule = buildRRule({ frequency: 'weekly', daysOfWeek: [0], until: new Date('2026-09-14') });
    const dates = expandRecurrenceFromLocalString('2026-09-07T18:00', rule, d => d);
    expect(dates.map(d => d.toISOString())).toEqual(['2026-09-07T18:00:00.000Z']);
  });
  it('event email formats a 6pm Los Angeles practice as 1am on a UTC server', () => {
    const prior = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const html = buildEventEmailHtml({
        eventTitle: 'Audit practice', eventType: 'practice', startTime: '2026-09-08T01:00:00Z',
        endTime: '2026-09-08T02:00:00Z', location: null, teamName: 'Audit team', action: 'created',
      });
      expect(html).toContain('1:00 AM');
      expect(html).toContain('Tuesday, September 8, 2026');
    } finally {
      if (prior === undefined) delete process.env.TZ;
      else process.env.TZ = prior;
    }
  });
});
