# Tracker de sourcing

Page statique (GitHub Pages) branchée sur Supabase. Rien du tracker n'est visible avant la connexion d'un membre autorisé.

- `index.html` : l'outil. Les constantes `SB_URL` et `SB_KEY` pointent vers le projet Supabase (la clé publishable est publique par conception; les règles RLS protègent les données).
- `supabase.sql` : schéma, règles d'accès et synchronisation en direct. Aucune donnée.
- `supabase-acces.sql` : rôles (administrateur, membre) et fonctions utilisées par la gestion des comptes. À exécuter après `supabase.sql`.
- `supabase/functions/acces/index.ts` : fonction serveur « acces » (Edge Function, déployée avec `verify_jwt = false` : elle vérifie elle-même la session). Elle seule détient la clé d'administration.

## Comptes et accès

Bouton « Comptes et accès » en haut de la page :

- tout le monde peut changer son mot de passe;
- un administrateur donne ou retire un accès, change un rôle, et envoie un lien de connexion (par courriel, ou copié pour l'envoyer soi-même).

Les inscriptions publiques restent fermées : un compte n'existe que si un administrateur l'a créé. Retirer quelqu'un supprime son compte et coupe son accès aux données tout de suite.

Connexion : mot de passe, ou « Recevoir un lien par courriel » sur l'écran de connexion. Un lien sert une fois et expire après 1 heure.

Courriels : sans serveur SMTP configuré dans Supabase (Authentication → Emails → SMTP Settings), Supabase n'envoie qu'aux membres de l'équipe du projet Supabase, 2 courriels par heure au maximum. « Copier un lien » fonctionne sans SMTP.
