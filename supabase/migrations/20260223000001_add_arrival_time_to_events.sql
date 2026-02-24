-- Add optional arrival_time field to events.
-- Stores the number of minutes before start_time that attendees should arrive.
alter table events add column arrival_time integer;
