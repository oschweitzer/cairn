-- Passage de la palette de tags au registre nordique.
--
-- Les dix teintes changent de nom en même temps qu'elles changent de valeur
-- dans src/ui/theme.ts. La base ne stocke que la clé, jamais l'hexadécimal :
-- c'est donc ici, et seulement ici, qu'il y a quelque chose à faire côté données.
--
-- `alter type ... rename value` renomme l'étiquette d'une valeur d'énumération
-- sans toucher aux lignes. Aucune table n'est réécrite, aucun index n'est
-- reconstruit, et les valeurs déjà stockées suivent le nouveau nom : un tag
-- créé en « ocre » se lit désormais « ambre », c'est la même entrée. Une
-- migration en deux temps (ajouter les nouvelles valeurs, mettre à jour les
-- lignes, retirer les anciennes) serait plus longue, plus risquée, et
-- inutilisable ici puisque PostgreSQL ne sait pas supprimer une valeur d'enum.
--
-- Le défaut de tags.color_key suit automatiquement : il pointe sur l'entrée
-- d'énumération, pas sur son texte. 'silex' devenu 'fer', le défaut est 'fer'.
--
-- Correspondance, dans l'ordre de déclaration du type :
--   ocre       -> ambre      l'ambre de la Baltique
--   oxyde      -> braise     la forge
--   grenat     -> airelle    la baie rouge des sous-bois du Nord
--   amethyste  -> bruyere    la lande
--   ardoise    -> fjord      l'eau froide
--   malachite  -> aurore     l'aurore boréale, teinte de l'accent
--   mousse     -> lichen     ce qui pousse sur la pierre
--   silex      -> fer        le métal, teinte neutre et défaut
--   craie      -> bouleau    l'écorce claire
--   basalte    -> granit     la roche du socle

alter type tag_color rename value 'ocre' to 'ambre';
alter type tag_color rename value 'oxyde' to 'braise';
alter type tag_color rename value 'grenat' to 'airelle';
alter type tag_color rename value 'amethyste' to 'bruyere';
alter type tag_color rename value 'ardoise' to 'fjord';
alter type tag_color rename value 'malachite' to 'aurore';
alter type tag_color rename value 'mousse' to 'lichen';
alter type tag_color rename value 'silex' to 'fer';
alter type tag_color rename value 'craie' to 'bouleau';
alter type tag_color rename value 'basalte' to 'granit';

comment on type tag_color is
  'Clés de la palette de tags. Les valeurs hexadécimales vivent dans '
  'src/ui/theme.ts et dépendent du thème actif, la base ne stocke que la clé.';
