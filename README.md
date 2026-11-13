# Tracker de sourcing

Page statique (GitHub Pages) branchée sur Supabase. Les données ne sont lisibles qu'après connexion d'un membre autorisé.

- `index.html` : l'outil. Les constantes `SB_URL` et `SB_KEY` pointent vers le projet Supabase (la clé publishable est publique par conception; les règles RLS protègent les données).
- `supabase.sql` : schéma, règles d'accès et synchronisation en direct. Aucune donnée.

Donner accès à quelqu'un : créer son compte dans Supabase (Authentication → Users → Add user), puis ajouter son courriel à la table `membres` (voir la fin de `supabase.sql`).
