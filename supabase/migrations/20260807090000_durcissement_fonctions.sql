-- Durcissement des fonctions, sur signalement de l'auditeur Supabase.
--
-- Rien d'exploitable n'a été trouvé : les deux fonctions concernées s'exécutent
-- avec les droits de l'appelant, donc sous RLS. C'est de l'hygiène, pas un
-- correctif d'urgence — mais elle est gratuite et referme la porte avant qu'une
-- fonction future, elle en droits du définisseur, ne s'y engouffre.

-- ------------------------------------------- chemin de recherche figé

-- Sans chemin fixé, un appelant peut placer devant `public` un schéma à lui
-- contenant une table ou une fonction homonyme, et détourner ce que le corps
-- désigne. Figer le chemin ferme cette porte.
--
-- `public` et non la chaîne vide que recommande la documentation : les corps
-- ci-dessous nomment leurs tables sans les qualifier, et vider le chemin les
-- casserait. Le figer suffit à l'usage.
alter function public.touch_updated_at() set search_path = public;
alter function public.reorder_checklist_items(uuid, uuid[]) set search_path = public;

-- ------------------------------------- droits d'exécution des déclencheurs

/*
 * Les deux fonctions de déclencheur n'ont aucune raison d'être appelables.
 *
 * L'auditeur les signale comme joignables par `/rest/v1/rpc/`, ce qui surévalue
 * le risque : elles retournent `trigger`, et PostgREST n'expose pas ce type-là.
 * Le droit n'en reste pas moins accordé sans raison, et un droit inutile est un
 * droit à retirer.
 *
 * Le retrait vise `public` et non les rôles nommés. Postgres accorde `execute`
 * à `public` par défaut sur toute fonction : retirer le droit à `anon` et à
 * `authenticated` ne leur enlève rien, puisqu'ils le tiennent de là. Une
 * première tentative ainsi rédigée a été appliquée sans le moindre effet.
 *
 * Un déclencheur continue de se déclencher : Postgres vérifie `execute` à la
 * création du déclencheur, pas à chaque fois qu'il tire. Le test
 * « updated_at avance à la modification » de scripts/test-schema.mts le
 * démontre — il s'exécute sous le rôle `authenticated`, qui n'a plus ce droit.
 *
 * `reorder_checklist_items` n'est pas touchée : l'application l'appelle en RPC,
 * lui retirer le droit la casserait.
 */
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.create_profile_for_new_user() from public;
