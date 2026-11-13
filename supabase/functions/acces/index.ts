// Fonction serveur « acces » : gestion des comptes du tracker de sourcing.
// Appelée par la page (bouton « Comptes et accès »), réservée aux administrateurs (table public.membres, role = 'admin').
// La clé d'administration reste ici, côté Supabase : elle n'apparaît jamais dans la page publique.
// Déploiement : verify_jwt = false (la fonction vérifie elle-même la session avec auth.getUser).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ORIGINE = "https://vicstlouis.github.io";
const PAGE = "https://vicstlouis.github.io/basalt-tracker/";

function cleServeur(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const cles = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const v = Object.values(cles)[0];
    if (typeof v === "string" && v) return v;
  } catch { /* rien */ }
  throw new Error("Clé serveur introuvable dans l'environnement de la fonction.");
}
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", cleServeur(), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
});

const CORS = {
  "Access-Control-Allow-Origin": ORIGINE,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const rep = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const refus = (status: number, erreur: string) => rep(status, { erreur });

const ROLES = ["admin", "membre"];
const courrielValide = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

type Compte = {
  email: string; nom: string | null; role: string; ajoute_le: string | null; ajoute_par: string | null;
  user_id: string | null; derniere_connexion: string | null;
};

async function comptes(): Promise<Compte[]> {
  const { data, error } = await admin.rpc("comptes_admin");
  if (error) throw new Error("Lecture des comptes impossible : " + error.message);
  return (data ?? []) as Compte[];
}

// Crée le compte de connexion s'il n'existe pas encore (courriel confirmé, sans mot de passe).
// Les inscriptions publiques restent fermées : seul un administrateur fait exister un compte.
async function assurerCompte(email: string, userId: string | null): Promise<void> {
  if (userId) return;
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error && !/already/i.test(error.message)) throw new Error("Création du compte impossible : " + error.message);
}

function messageCourriel(e: { code?: string; message?: string; status?: number }): string {
  const c = e.code ?? "";
  if (c === "email_address_not_authorized") {
    return "Supabase refuse d'envoyer à cette adresse : sans serveur courriel (SMTP) à lui, il n'écrit qu'aux membres de l'équipe du projet Supabase. Utilise « Copier un lien » en attendant.";
  }
  if (/rate_limit/.test(c) || e.status === 429) {
    return "Limite d'envoi atteinte (sans serveur SMTP : 2 courriels par heure; et au plus 1 par minute par adresse). Utilise « Copier un lien » ou réessaie plus tard.";
  }
  return "Le courriel n'est pas parti (" + (e.message ?? "erreur inconnue") + "). Utilise « Copier un lien ».";
}

async function envoyerLien(email: string): Promise<string | null> {
  const { error } = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: PAGE } });
  return error ? messageCourriel(error) : null;
}

function traduire(m: string): string {
  if (/au moins un administrateur/i.test(m)) return "Il doit rester au moins un administrateur.";
  if (/membres_email_minuscules|membres_role_valide|check constraint/i.test(m)) return "Courriel ou rôle invalide.";
  return "Modification refusée : " + m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return refus(405, "Méthode non permise.");

  try {
    // 1. Qui appelle ? (jeton de session envoyé par la page)
    const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: qui, error: errQui } = await admin.auth.getUser(jeton);
    const moi = (qui?.user?.email ?? "").toLowerCase();
    if (errQui || !moi) return refus(401, "Session expirée : reconnecte-toi.");

    const liste = await comptes();
    if (liste.find((c) => c.email === moi)?.role !== "admin") return refus(403, "Réservé aux administrateurs du tracker.");

    // 2. Quoi faire ?
    let corps: Record<string, unknown>;
    try { corps = await req.json(); } catch { return refus(400, "Requête illisible."); }
    const action = String(corps.action ?? "");
    const email = String(corps.email ?? "").trim().toLowerCase();
    const cible = liste.find((c) => c.email === email);

    switch (action) {
      case "lister":
        return rep(200, { comptes: liste });

      case "ajouter": {
        if (!courrielValide(email)) return refus(400, "Courriel invalide.");
        const role = ROLES.includes(String(corps.role)) ? String(corps.role) : "membre";
        const nom = String(corps.nom ?? "").trim().slice(0, 120) || null;
        if (cible) {
          if (email === moi && role !== cible.role) return refus(400, "Un autre administrateur doit changer ton rôle.");
          const { error } = await admin.from("membres").update(nom ? { role, nom } : { role }).eq("email", email);
          if (error) return refus(400, traduire(error.message));
        } else {
          const { error } = await admin.from("membres").insert({ email, nom, role, ajoute_par: moi });
          if (error) return refus(400, traduire(error.message));
        }
        await assurerCompte(email, cible?.user_id ?? null);
        if (!corps.envoyer) return rep(200, { message: `Accès donné à ${email}. Envoie-lui un lien quand tu veux.` });
        const pb = await envoyerLien(email);
        return pb
          ? rep(200, { message: `Accès donné à ${email}, mais le courriel n'est pas parti. ${pb}`, avertissement: true })
          : rep(200, { message: `Accès donné à ${email}. Le lien de connexion est parti par courriel (valide 1 heure).` });
      }

      case "role": {
        if (!cible) return refus(404, "Ce courriel n'a pas accès.");
        const role = String(corps.role ?? "");
        if (!ROLES.includes(role)) return refus(400, "Rôle inconnu.");
        if (email === moi) return refus(400, "Un autre administrateur doit changer ton rôle.");
        const { error } = await admin.from("membres").update({ role }).eq("email", email);
        if (error) return refus(400, traduire(error.message));
        return rep(200, { ok: true });
      }

      case "envoyer": {
        if (!cible) return refus(404, "Ce courriel n'a pas accès.");
        await assurerCompte(email, cible.user_id);
        const pb = await envoyerLien(email);
        return pb ? refus(400, pb) : rep(200, { ok: true });
      }

      case "lien": {
        if (!cible) return refus(404, "Ce courriel n'a pas accès.");
        await assurerCompte(email, cible.user_id);
        const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: PAGE } });
        const lien = data?.properties?.action_link;
        if (error || !lien) return refus(500, "Lien impossible à créer : " + (error?.message ?? "réponse vide"));
        return rep(200, { lien });
      }

      case "retirer": {
        if (!cible) return refus(404, "Ce courriel n'a déjà plus accès.");
        if (email === moi) return refus(400, "Tu ne peux pas retirer ton propre accès.");
        const { error } = await admin.from("membres").delete().eq("email", email);
        if (error) return refus(400, traduire(error.message));
        if (cible.user_id) {
          const { error: e2 } = await admin.auth.admin.deleteUser(cible.user_id);
          if (e2) return rep(200, { ok: true, message: "Accès retiré, mais le compte n'a pas pu être supprimé : " + e2.message });
        }
        return rep(200, { ok: true });
      }

      default:
        return refus(400, "Action inconnue.");
    }
  } catch (e) {
    return refus(500, (e as Error).message || "Erreur du serveur.");
  }
});
