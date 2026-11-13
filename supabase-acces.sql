-- Tracker de sourcing : comptes et accès gérés depuis la page.
-- À exécuter après supabase.sql (Supabase → SQL Editor → New query → coller → Run). Peut être relancé sans risque.
-- La page n'écrit jamais dans « membres » directement : elle passe par la fonction serveur « acces »
-- (supabase/functions/acces), qui vérifie que la personne connectée est administratrice.

-- 1. Rôle, nom et historique de chaque membre
alter table public.membres add column if not exists nom        text;
alter table public.membres add column if not exists role       text not null default 'membre';
alter table public.membres add column if not exists ajoute_le  timestamptz not null default now();
alter table public.membres add column if not exists ajoute_par text;
update public.membres set email = lower(trim(email)) where email <> lower(trim(email));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membres_role_valide') then
    alter table public.membres add constraint membres_role_valide check (role in ('admin', 'membre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'membres_email_minuscules') then
    alter table public.membres add constraint membres_email_minuscules check (email = lower(email));
  end if;
end $$;

-- 2. Premier administrateur : s'il n'y en a encore aucun, les membres existants le deviennent
update public.membres set role = 'admin'
where not exists (select 1 from public.membres where role = 'admin');

-- 3. Il reste toujours au moins un administrateur
create or replace function public.garder_un_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.membres where role = 'admin') then
    raise exception 'Il doit rester au moins un administrateur.';
  end if;
  return null;
end $$;
drop trigger if exists garder_un_admin on public.membres;
create trigger garder_un_admin after update or delete on public.membres
  for each statement execute function public.garder_un_admin();

-- 4. Rôle de la personne connectée (la page s'en sert pour afficher ou non la gestion des comptes)
create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.membres where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
revoke all on function public.mon_role() from public, anon;
grant execute on function public.mon_role() to authenticated;

-- 5. Liste des comptes, réservée à la fonction serveur (jamais appelable depuis la page)
create or replace function public.comptes_admin()
returns table (email text, nom text, role text, ajoute_le timestamptz, ajoute_par text, user_id uuid, derniere_connexion timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.email, m.nom, m.role, m.ajoute_le, m.ajoute_par, u.id, u.last_sign_in_at
  from public.membres m
  left join auth.users u on lower(u.email) = m.email
  order by (m.role = 'admin') desc, coalesce(m.nom, m.email);
$$;
revoke all on function public.comptes_admin() from public, anon, authenticated;
grant execute on function public.comptes_admin() to service_role;

-- 6. La liste des membres reste invisible depuis la page (aucune règle RLS pour anon ou authenticated)
alter table public.membres enable row level security;
revoke all on public.membres from anon, authenticated;
grant select, insert, update, delete on public.membres to service_role;
