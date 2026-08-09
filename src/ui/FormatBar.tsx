import { ScrollView, View } from 'react-native'
import type { Format } from '@/text/markup'
import { IconButton } from './IconButton'
import { Txt } from './components'
import { space } from './theme'

/**
 * Barre de mise en forme.
 *
 * Elle n'écrit rien elle-même : elle nomme un geste, l'écran décide sur quel
 * champ l'appliquer. C'est ce qui lui permet de servir aussi bien au corps d'une
 * note qu'à l'élément de liste que l'on est en train de modifier, sans qu'elle
 * ait à connaître ni l'un ni l'autre.
 *
 * Les commandes défilent horizontalement : neuf cibles de 44 points ne tiennent
 * pas sur un écran de 360, et un retour à la ligne ferait grandir le panneau
 * juste au-dessus du clavier, là où la place est la plus rare.
 */
export function FormatBar({
  onFormat,
  onLink,
  disabled = false,
  hint,
}: {
  onFormat: (format: Format) => void
  onLink: () => void
  disabled?: boolean
  /** Ce sur quoi la commande va s'appliquer, ou ce qu'il manque pour qu'elle le puisse. */
  hint: string
}) {
  return (
    <View style={{ gap: space.xxs }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ alignItems: 'center' }}
      >
        <IconButton
          icon="bold"
          label="Gras"
          tooltip="Gras"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('bold')}
        />
        <IconButton
          icon="italic"
          label="Italique"
          tooltip="Italique"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('italic')}
        />
        <IconButton
          icon="underline"
          label="Souligné"
          tooltip="Souligné"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('underline')}
        />
        <IconButton
          icon="strikethrough"
          label="Barré"
          tooltip="Barré"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('strike')}
        />
        <IconButton
          icon="letterLarge"
          label="Grand titre"
          tooltip="Grand titre"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('title')}
        />
        <IconButton
          icon="letterSmall"
          label="Sous-titre"
          tooltip="Sous-titre"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('subtitle')}
        />
        <IconButton
          icon="list"
          label="Liste à puces"
          tooltip="Liste à puces"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={() => onFormat('bullet')}
        />
        <IconButton
          icon="link"
          label="Lien"
          tooltip="Insérer un lien"
          placement="top"
          size="sm"
          disabled={disabled}
          onPress={onLink}
        />
      </ScrollView>
      <Txt variant="caption" tone="muted">
        {hint}
      </Txt>
    </View>
  )
}
