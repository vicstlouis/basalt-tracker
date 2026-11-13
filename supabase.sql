-- Tracker de sourcing : schéma Supabase.
-- À exécuter une seule fois : Supabase → SQL Editor → New query → coller → Run.
-- Ce fichier ne contient aucune donnée. Les cibles se chargent avec un fichier séparé, gardé hors du dépôt.

-- 1. Données : une table qui reproduit les collections du tracker (cibles, univers, config)
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- 2. Membres autorisés : un courriel par personne qui a accès
create table if not exists public.membres (
  email text primary key
);

-- 3. Vérifie que la personne connectée est membre (utilisée par les règles d'accès et par la page)
create or replace function public.est_membre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membres
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.est_membre() from public, anon;
grant execute on function public.est_membre() to authenticated;

-- 4. Règles d'accès (RLS) : seuls les membres connectés lisent et écrivent; rien n'est lisible sans connexion
alter table public.docs enable row level security;
alter table public.membres enable row level security;  -- aucune règle : la liste des membres reste invisible depuis la page

drop policy if exists "membres lisent" on public.docs;
drop policy if exists "membres ajoutent" on public.docs;
drop policy if exists "membres modifient" on public.docs;
drop policy if exists "membres suppriment" on public.docs;
create policy "membres lisent"     on public.docs for select to authenticated using (public.est_membre());
create policy "membres ajoutent"   on public.docs for insert to authenticated with check (public.est_membre());
create policy "membres modifient"  on public.docs for update to authenticated using (public.est_membre()) with check (public.est_membre());
create policy "membres suppriment" on public.docs for delete to authenticated using (public.est_membre());

revoke all on public.docs from anon;
revoke all on public.membres from anon, authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- 5. Synchronisation en direct (les modifications des autres apparaissent sans recharger)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- 6. Donner accès à quelqu'un (exécuter une ligne par personne, avec le courriel de son compte Supabase) :
--    insert into public.membres (email) values ('courriel@exemple.com') on conflict do nothing;
-- Retirer un accès :
--    delete from public.membres where email = 'courriel@exemple.com';
