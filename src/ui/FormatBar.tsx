import { ScrollView, View } from 'react-native'
import type { Format } from '@/text/markup'
import { IconButton } from './IconButton'
import { Txt } from './components'
import { space } from './theme'

/**
 * The format bar.
 *
 * It writes nothing itself: it names a gesture, and the screen decides which
 * field to apply it to. That is what lets it serve a note's body as well as the
 * list item being edited, without having to know either.
 *
 * The commands scroll horizontally: nine 44-point targets do not fit on a 360
 * screen, and wrapping would make the panel grow right above the keyboard,
 * where room is scarcest.
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
  /** What the command will apply to, or what is missing for it to be able to. */
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
