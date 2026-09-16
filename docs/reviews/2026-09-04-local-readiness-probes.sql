-- Local-only verification. Synthetic fixtures; every mutation is rolled back.
-- Run ONLY against supabase_db_lista, never a hosted database.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE audit_ids AS SELECT gen_random_uuid() owner_id, gen_random_uuid() outsider_id,
  gen_random_uuid() claimant_id, gen_random_uuid() player_id, gen_random_uuid() org_id,
  gen_random_uuid() team_id, gen_random_uuid() group_id;
GRANT SELECT ON audit_ids TO authenticated;
INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT owner_id, owner_id || '@readiness.invalid', '{"first_name":"Audit owner"}'::jsonb FROM audit_ids
UNION ALL SELECT outsider_id, outsider_id || '@readiness.invalid', '{"first_name":"Audit outsider"}'::jsonb FROM audit_ids
UNION ALL SELECT claimant_id, claimant_id || '@readiness.invalid', '{"first_name":"Audit claimant"}'::jsonb FROM audit_ids;
INSERT INTO profiles(id,first_name,last_name,email) SELECT player_id,'Audit','Player','' FROM audit_ids;
INSERT INTO organizations(id,name,slug) SELECT org_id,'Readiness audit',org_id::text FROM audit_ids;
INSERT INTO organization_members(organization_id,profile_id,role) SELECT org_id,owner_id,'owner' FROM audit_ids;
INSERT INTO teams(id,organization_id,name,owner_id) SELECT team_id,org_id,'Readiness audit',owner_id FROM audit_ids;
INSERT INTO team_members(team_id,profile_id,role) SELECT team_id,owner_id,'coach' FROM audit_ids
UNION ALL SELECT team_id,player_id,'player' FROM audit_ids;
INSERT INTO push_subscriptions(profile_id,expo_push_token) SELECT owner_id,'ExponentPushToken[audit-owner]' FROM audit_ids
UNION ALL SELECT outsider_id,'ExponentPushToken[audit-outsider]' FROM audit_ids;
INSERT INTO channels(id,team_id,name,type,created_by) SELECT group_id,team_id,'Private audit group','group',owner_id FROM audit_ids;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',outsider_id,'role','authenticated')::text,true) IS NOT NULL AS outsider_session FROM audit_ids;
SELECT count(*) AS outsider_teams_before FROM teams WHERE id=(SELECT team_id FROM audit_ids);
INSERT INTO team_members(team_id,profile_id,role) SELECT team_id,outsider_id,'coach' FROM audit_ids;
SELECT is_team_admin(team_id) AS outsider_self_granted_admin FROM audit_ids;
SELECT count(*) AS teammate_push_tokens_visible FROM push_subscriptions WHERE profile_id=(SELECT owner_id FROM audit_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',claimant_id,'role','authenticated')::text,true) IS NOT NULL AS claimant_session FROM audit_ids;
INSERT INTO profile_managers(manager_id,managed_id) SELECT claimant_id,player_id FROM audit_ids;
UPDATE profiles SET first_name='Unauthorized audit change' WHERE id=(SELECT player_id FROM audit_ids);
SELECT is_team_member(team_id) AS claimant_gained_team_access FROM audit_ids;
INSERT INTO channel_members(channel_id,profile_id) SELECT group_id,claimant_id FROM audit_ids;
SELECT count(*) AS self_joined_private_groups FROM channels WHERE id=(SELECT group_id FROM audit_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) IS NOT NULL AS owner_session FROM audit_ids;
UPDATE organizations SET plan='club_large',subscription_status='active' WHERE id=(SELECT org_id FROM audit_ids);
SELECT plan,subscription_status AS client_written_billing_status FROM organizations WHERE id=(SELECT org_id FROM audit_ids);
RESET ROLE;
SELECT first_name AS claimed_player_name FROM profiles WHERE id=(SELECT player_id FROM audit_ids);
UPDATE team_members SET role='player' WHERE profile_id=(SELECT outsider_id FROM audit_ids);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',outsider_id,'role','authenticated')::text,true) IS NOT NULL AS ordinary_player_session FROM audit_ids;
SELECT count(email) AS ordinary_player_can_read_coach_email FROM profiles WHERE id=(SELECT owner_id FROM audit_ids);
RESET ROLE;
CREATE TEMP TABLE audit_event_ids AS SELECT gen_random_uuid() parent_id,gen_random_uuid() child_id;
INSERT INTO events(id,team_id,title,event_type,start_time,end_time,recurrence_rule)
SELECT parent_id,team_id,'Audit series','practice',now(),now()+interval '1 hour','FREQ=WEEKLY;COUNT=2' FROM audit_ids CROSS JOIN audit_event_ids;
INSERT INTO events(id,team_id,title,event_type,start_time,end_time,parent_event_id,score_for,score_against,is_cancelled)
SELECT child_id,team_id,'Audit child','practice',now()+interval '7 days',now()+interval '7 days 1 hour',parent_id,3,1,true FROM audit_ids CROSS JOIN audit_event_ids;
INSERT INTO availability(event_id,profile_id,status) SELECT child_id,player_id,'available' FROM audit_ids CROSS JOIN audit_event_ids;
SELECT count(*) AS child_rsvps_before_series_rebuild FROM availability WHERE event_id=(SELECT child_id FROM audit_event_ids);
DELETE FROM events WHERE parent_event_id=(SELECT parent_id FROM audit_event_ids);
SELECT count(*) AS child_rsvps_after_series_rebuild FROM availability WHERE event_id=(SELECT child_id FROM audit_event_ids);
ROLLBACK;
