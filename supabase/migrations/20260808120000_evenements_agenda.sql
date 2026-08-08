-- Export d'une note vers Google Agenda.
--
-- Le schéma initial avait déjà tout prévu côté rappels : `google_kind` sait
-- valoir 'event', `google_id` attend l'identifiant rendu par Google, et
-- `sync_state` porte déjà l'issue de l'échange. Il manquait deux choses, que
-- l'usage a fait apparaître et non la relecture du modèle.
--
-- 1. Un rappel a un instant, un évènement a une durée. `remind_at` disait quand
--    prévenir ; il dit désormais aussi quand l'évènement commence, et `ends_at`
--    quand il finit. Sans cette colonne, tout évènement aurait duré ce que
--    Google décide par défaut, c'est-à-dire une heure, sans que Cairn ne sache
--    seulement le dire à l'utilisateur.
--
-- 2. Google rend une URL vers l'évènement créé. Ne pas la garder obligerait à
--    rappeler l'API pour rouvrir ce qu'on vient d'écrire, alors qu'une colonne
--    de texte suffit.
--
-- La troisième partie de ce fichier est d'une autre nature. Elle inscrit dans
-- la base la règle décidée pour les notes protégées, plutôt que de la confier
-- au seul client. Voir le commentaire qui l'introduit.

-- --------------------------------------------------------- fin de créneau

alter table reminders add column ends_at timestamptz;

comment on column reminders.ends_at is
  'Fin du créneau pour un export ''event''. Nulle pour un rappel purement local.';

-- Un créneau qui finit avant de commencer n'est pas une donnée à corriger plus
-- tard, c'est une donnée à refuser tout de suite. L'égalité est refusée aussi :
-- Google accepte un évènement de durée nulle, mais il n'apparaît alors dans
-- aucune vue de l'agenda, ce qui ressemble en tout point à un export perdu.
alter table reminders add constraint ends_after_start check (
  ends_at is null or ends_at > remind_at
);

-- ------------------------------------------------------- retour vers Google

alter table reminders add column google_html_link text;

comment on column reminders.google_html_link is
  'URL de l''évènement chez Google, telle que rendue à la création. Permet de le rouvrir sans rappeler l''API.';

-- ------------------------------------- refus d'exporter une note protégée
--
-- Cairn chiffre certaines notes de bout en bout et en range d'autres dans le
-- coffre. Les envoyer chez Google reviendrait à défaire cette promesse, et la
-- défaire d'autant plus discrètement que rien, dans l'agenda, ne rappellerait
-- d'où vient la ligne.
--
-- L'interface masque déjà le bouton sur ces notes-là. Cela ne suffit pas : une
-- note peut être rangée dans le coffre après coup, un client tiers peut écrire
-- dans la table, et une régression d'affichage ne se voit pas. La règle tient
-- donc ici, au même titre que « un rappel vise une note ou un élément, jamais
-- les deux ».
--
-- Le déclencheur ne regarde que les lignes qui portent un `google_kind` : un
-- rappel purement local sur une note du coffre reste légitime, il ne quitte
-- pas l'appareil et le nom de code le couvre déjà.
create or replace function refuse_export_note_protegee() returns trigger
language plpgsql
set search_path = public
as $$
declare
  protegee boolean;
begin
  if new.google_kind is null then
    return new;
  end if;

  -- Le rappel vise une note ou un élément de liste, jamais les deux : la
  -- contrainte `exactly_one_target` le garantit. `coalesce` remonte donc à la
  -- note dans les deux cas, l'élément passant par sa note porteuse.
  select n.is_encrypted or n.is_private
    into protegee
    from notes n
   where n.id = coalesce(
           new.note_id,
           (select c.note_id from checklist_items c where c.id = new.checklist_item_id)
         );

  if protegee then
    raise exception
      'export Google refusé : la note est chiffrée ou rangée dans le coffre'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger reminders_refuse_export_note_protegee
  before insert or update on reminders
  for each row execute function refuse_export_note_protegee();

-- Même raisonnement que dans 20260807090000 : le droit d'exécution accordé à
-- `public` par défaut ne sert à rien ici, et un droit inutile est un droit à
-- retirer. Le déclencheur continue de tirer, Postgres ayant vérifié le droit à
-- sa création.
revoke execute on function public.refuse_export_note_protegee() from public;

-- ------------------------------------------------------------------ index

-- Rouvrir l'évènement depuis une note demande de retrouver ses exports. Sans
-- index, c'est un balayage de toute la table de la personne à chaque ouverture
-- de note.
create index reminders_google_events_idx on reminders (note_id, remind_at desc)
  where google_kind = 'event';
