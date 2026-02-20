alter table teams add column sport text;
alter table teams add column league text;
alter table teams add column league_url text;
alter table teams add column age_group text;
alter table teams add column gender text;
alter table teams add column home_uniform text;
alter table teams add column away_uniform text;
alter table teams add column timezone text;
alter table teams add column country text;
alter table teams add column zip text;

alter table teams add constraint teams_sport_check
  check (sport in ('baseball','basketball','cricket','field_hockey','flag_football','football','golf','gymnastics','ice_hockey','lacrosse','pickleball','rugby','soccer','softball','swimming','tennis','track_and_field','volleyball','wrestling','other'));

alter table teams add constraint teams_age_group_check
  check (age_group in ('6u','7u','8u','9u','10u','11u','12u','13u','14u','15u','16u','17u','18u','high_school','college','adult'));

alter table teams add constraint teams_gender_check
  check (gender in ('male','female','coed'));
