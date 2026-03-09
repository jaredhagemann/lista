-- Enable Supabase Realtime for the messages table
-- Required for postgres_changes subscriptions in the chat UI
alter publication supabase_realtime add table messages;
