// Review evidence: these assert observed defects, NOT desired regression behavior.
// Local Supabase only (enforced by helpers.ts). No email delivery or production writes.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { adminClient, createTestUser, createTestTeam, createManagedProfile, addTeamMember, cleanupTestData } from '../../tests/rls/helpers';

const session = vi.hoisted(() => ({ client: null as any }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }));
import { POST as acceptInvitation } from '@/app/api/invite/[id]/accept/route';

afterAll(cleanupTestData);

async function accept(id: string, type: 'self' | 'manager') {
  return acceptInvitation(new Request('http://localhost/api/invite/' + id + '/accept', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }),
  }), { params: Promise.resolve({ id }) });
}

describe('BUG-002 merged-fix gap probes', () => {
  it('an unrelated coach manufactures membership, then acquires guardianship across clubs', async () => {
    const legitimateCoach = await createTestUser();
    const parent = await createTestUser();
    const attacker = await createTestUser();
    const { teamId: realTeam } = await createTestTeam(legitimateCoach.user.id);
    const { teamId: attackerTeam } = await createTestTeam(attacker.user.id);
    const child = await createManagedProfile(parent.user.id);
    await addTeamMember(realTeam, child);
    session.client = attacker.client;
    expect((await attacker.client.rpc('is_team_member', { t_id: realTeam })).data).toBe(false);

    // All attack writes use the attacker's authenticated client, not service role.
    const membership = await attacker.client.from('team_members').insert({ team_id: attackerTeam, profile_id: child, role: 'player' });
    expect(membership.error).toBeNull();
    const inviteId = crypto.randomUUID();
    const invitation = await attacker.client.from('invitations').insert({ id: inviteId, team_id: attackerTeam, managed_profile_id: child, email: attacker.user.email, role: 'manager', invited_by: attacker.user.id });
    expect(invitation.error).toBeNull();
    const response = await accept(inviteId, 'manager');
    expect(response.status).toBe(200);
    expect((await attacker.client.rpc('is_team_member', { t_id: realTeam })).data).toBe(true);
    expect((await attacker.client.from('profiles').update({ first_name: 'Claimed through fabricated membership' }).eq('id', child)).error).toBeNull();
    const { data: stored } = await adminClient.from('profiles').select('first_name').eq('id', child).single();
    expect(stored?.first_name).toBe('Claimed through fabricated membership');
  });

  it('a guardian invite for an own child can be accepted as coach of an unrelated team', async () => {
    const coach = await createTestUser();
    const attacker = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const ownChild = await createManagedProfile(attacker.user.id);
    session.client = attacker.client;
    expect((await attacker.client.rpc('is_team_admin', { t_id: teamId })).data).toBe(false);
    const inviteId = crypto.randomUUID();
    const invitation = await attacker.client.from('invitations').insert({ id: inviteId, team_id: teamId, managed_profile_id: ownChild, email: attacker.user.email, role: 'coach', invited_by: attacker.user.id });
    expect(invitation.error).toBeNull();
    // Recipient email matches: this does not rely on BUG-012's missing web email check.
    const response = await accept(inviteId, 'self');
    expect(response.status).toBe(200);
    expect((await attacker.client.rpc('is_team_admin', { t_id: teamId })).data).toBe(true);
  });

  it('removing own Self link disables player invitation authority and cannot be repaired by the player', async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id);
    const args = { p_team_id: teamId, p_managed_profile_id: player.user.id };
    expect((await player.client.rpc('can_invite_guardian_for', args)).data).toBe(true);
    expect((await player.client.from('profile_managers').delete().eq('manager_id', player.user.id).eq('managed_id', player.user.id)).error).toBeNull();
    expect((await player.client.rpc('can_invite_guardian_for', args)).data).toBe(false);
    expect((await player.client.from('profile_managers').insert({ manager_id: player.user.id, managed_id: player.user.id, relationship: 'Self' })).error).not.toBeNull();
  });
});
