-- Local-only review probes. All fixtures and mutations are rolled back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, raw_user_meta_data) values
 ('01300000-0000-4000-8000-000000000001', 'bug013-owner@example.invalid', '{"first_name":"Owner"}'),
 ('01300000-0000-4000-8000-000000000002', 'bug013-director@example.invalid', '{"first_name":"Director"}'),
 ('01300000-0000-4000-8000-000000000003', 'bug013-outsider@example.invalid', '{"first_name":"Outsider"}');
insert into organizations (id, name, slug, plan, subscription_status, stripe_customer_id, trial_ends_at)
values ('01300000-0000-4000-8000-000000000010', 'BUG013 probe club', 'bug013-review-probe', 'club_small', 'trialing', 'cus_review_fake', now() - interval '1 day');
insert into organization_members (organization_id, profile_id, role) values
 ('01300000-0000-4000-8000-000000000010', '01300000-0000-4000-8000-000000000001', 'owner'),
 ('01300000-0000-4000-8000-000000000010', '01300000-0000-4000-8000-000000000002', 'director');
insert into teams (id, organization_id, name, owner_id)
values ('01300000-0000-4000-8000-000000000020', '01300000-0000-4000-8000-000000000010', 'Probe team', '01300000-0000-4000-8000-000000000001');
insert into team_members (team_id, profile_id, role) values
 ('01300000-0000-4000-8000-000000000020', '01300000-0000-4000-8000-000000000001', 'coach'),
 ('01300000-0000-4000-8000-000000000020', '01300000-0000-4000-8000-000000000002', 'director'),
 ('01300000-0000-4000-8000-000000000020', '01300000-0000-4000-8000-000000000003', 'player');

savepoint before_normal_transfer;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select start_ownership_transfer('01300000-0000-4000-8000-000000000001', '01300000-0000-4000-8000-000000000010', '01300000-0000-4000-8000-000000000002') as offer_id \gset
select respond_ownership_transfer('01300000-0000-4000-8000-000000000002', :'offer_id', true);
set constraints all immediate;
reset role;
select 'normal_accepted_transfer' as probe, profile_id, role from organization_members
where organization_id = '01300000-0000-4000-8000-000000000010' order by profile_id;
rollback to before_normal_transfer;

savepoint before_owner_change;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"01300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
-- Can the current owner give an outsider ownership with no accepted offer?
update organization_members set profile_id = '01300000-0000-4000-8000-000000000003'
where organization_id = '01300000-0000-4000-8000-000000000010' and role = 'owner';
set constraints all immediate;
reset role;
select 'ownership_without_acceptance' as probe, profile_id, role
from organization_members where organization_id = '01300000-0000-4000-8000-000000000010' and role = 'owner';
select 'transfer_records' as probe, count(*) from organization_ownership_transfers
where organization_id = '01300000-0000-4000-8000-000000000010';
rollback to before_owner_change;

savepoint before_director_delete;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"01300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
delete from organization_members where organization_id = '01300000-0000-4000-8000-000000000010'
and profile_id = '01300000-0000-4000-8000-000000000002';
reset role;
select 'director_roster_after_direct_delete' as probe, role from team_members
where team_id = '01300000-0000-4000-8000-000000000020' and profile_id = '01300000-0000-4000-8000-000000000002';
rollback to before_director_delete;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select close_club('01300000-0000-4000-8000-000000000001', '01300000-0000-4000-8000-000000000010', 'BUG013 probe club');
reset role;
-- The closure function normally runs in its own request/transaction. Clear its bypass.
select set_config('lista.club_admin', '', true);
select 'closed_trial_still_selected_by_cron' as probe, closed_at is not null as closed,
 subscription_status, stripe_customer_id from organizations
where id = '01300000-0000-4000-8000-000000000010'
and subscription_status = 'trialing' and trial_ends_at < now() and stripe_subscription_id is null;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"01300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  delete from team_members where team_id = '01300000-0000-4000-8000-000000000020'
  and profile_id = '01300000-0000-4000-8000-000000000003';
  raise notice 'closed_roster_revocation: succeeded';
exception when others then
  raise notice 'closed_roster_revocation: %', sqlerrm;
end $$;
reset role;
rollback;
