create table feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  type        text not null check (type in ('bug', 'feature')),
  description text not null check (char_length(description) >= 10),
  app_version text,
  created_at  timestamptz default now()
);

alter table feedback enable row level security;

-- Any authenticated user can submit feedback
create policy "Authenticated users can submit feedback"
  on feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- No SELECT policy — feedback is only readable via service role (Supabase Studio / admin)
