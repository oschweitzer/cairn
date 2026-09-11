-- Moving the tag palette to the Nordic register.
--
-- The ten hues change name at the same time as they change value in
-- src/ui/theme.ts. The database only stores the key, never the hexadecimal: so
-- it is here, and only here, that there is anything to do on the data side.
--
-- `alter type ... rename value` renames an enum value's label without touching
-- the rows. No table is rewritten, no index is rebuilt, and the values already
-- stored follow the new name: a tag created as 'ocre' now reads 'ambre', it is
-- the same entry. A two-step migration (add the new values, update the rows,
-- remove the old ones) would be longer, riskier, and unusable here since
-- PostgreSQL cannot drop an enum value.
--
-- The default of tags.color_key follows automatically: it points to the enum
-- entry, not to its text. With 'silex' turned into 'fer', the default is 'fer'.
--
-- Mapping, in the type's declaration order:
--   ocre       -> ambre      Baltic amber
--   oxyde      -> braise     the forge's ember
--   grenat     -> airelle    the red lingonberry of northern undergrowth
--   amethyste  -> bruyere    the heath's heather
--   ardoise    -> fjord      cold water
--   malachite  -> aurore     the northern lights, the accent's hue
--   mousse     -> lichen     what grows on stone
--   silex      -> fer        iron, the neutral hue and the default
--   craie      -> bouleau    the pale birch bark
--   basalte    -> granit     the bedrock's granite

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
