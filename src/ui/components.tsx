import { useCallback, useState } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from './ThemeProvider'
import { CAIRN, Rune, RuneRow, type RuneName } from './runes'
import { radius, space, type } from './theme'

/**
 * Primitives de l'interface. Elles portent l'identité de la pierre levée,
 * pendant que les affordances restent conventionnelles : un bouton ressemble à
 * un bouton, une case à cocher se coche. Le caractère passe par les surfaces, la
 * couleur, la typographie, le mouvement et la gravure, jamais par des repères
 * que l'on doit deviner.
 */

// ------------------------------------------------------- focus sur le web

/**
 * Neutralise l'anneau de focus par défaut du navigateur, qui est bleu et détonne
 * complètement dans une palette de pierre froide.
 *
 * À n'utiliser qu'avec un indicateur de focus de remplacement, sinon c'est une
 * régression d'accessibilité pure : la navigation au clavier deviendrait
 * invisible. Le hook `useFocusRing` ci-dessous fournit cet indicateur.
 *
 * `outlineStyle` est une propriété propre à react-native-web, absente des types
 * de React Native, d'où la conversion.
 */
export const noWebOutline = (
  Platform.OS === 'web' ? { outlineStyle: 'none' } : {}
) as Record<string, never>

/**
 * Suit l'état de focus d'un champ et rend les gestionnaires à brancher dessus.
 * Le rendu visuel du focus reste à la charge de l'appelant, qui sait s'il doit
 * teinter une bordure, un fond, ou les deux.
 */
export function useFocusRing(props?: Pick<TextInputProps, 'onFocus' | 'onBlur'>) {
  const [focused, setFocused] = useState(false)
  const onFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    (e) => {
      setFocused(true)
      props?.onFocus?.(e)
    },
    [props],
  )
  const onBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (e) => {
      setFocused(false)
      props?.onBlur?.(e)
    },
    [props],
  )
  return { focused, onFocus, onBlur }
}

// ------------------------------------------------------------------ écran

export function Screen({
  children,
  scroll = false,
  style,
  ...rest
}: ViewProps & { scroll?: boolean }) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const base = {
    flex: 1,
    backgroundColor: theme.surface.page,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
  }

  if (scroll) {
    return (
      <View style={[base, style]} {...rest}>
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    )
  }
  return (
    <View style={[base, { padding: space.lg, gap: space.md }, style]} {...rest}>
      {children}
    </View>
  )
}

// ------------------------------------------------------------------ strates

/**
 * Une pierre posée sur la page. Le contour vient de la couture, pas d'une ombre
 * portée : l'écart de teinte entre strates ne dépasse pas 1,20:1, c'est donc le
 * filet qui rend la carte perceptible.
 */
export function Card({
  children,
  raised = false,
  recessed = false,
  style,
  ...rest
}: ViewProps & { raised?: boolean; recessed?: boolean }) {
  const { theme } = useTheme()
  const background = recessed
    ? theme.surface.recessed
    : raised
      ? theme.surface.raised
      : theme.surface.card
  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.line.hairline,
          padding: space.md,
          gap: space.sm,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  )
}

/**
 * Couture géologique. Sépare deux strates sans les enfermer dans une boîte.
 *
 * Avec `mark`, la couture s'interrompt sur une rune gravée, comme un trait de
 * partage sur une pierre. Purement ornemental : la séparation reste lisible si
 * la rune ne se voit pas.
 */
export function Seam({ mark, style, ...rest }: ViewProps & { mark?: RuneName }) {
  const { theme } = useTheme()

  if (!mark) {
    return <View style={[{ height: 1, backgroundColor: theme.line.hairline }, style]} {...rest} />
  }

  const rule = { flex: 1, height: 1, backgroundColor: theme.line.hairline }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}
      {...rest}
    >
      <View style={rule} />
      <Rune name={mark} size={12} color={theme.line.strong} />
      <View style={rule} />
    </View>
  )
}

// --------------------------------------------------------------- typographie

type Variant = keyof typeof type
type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'onAccent'

export function Txt({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const { theme } = useTheme()
  const color =
    tone === 'accent'
      ? theme.accent.default
      : tone === 'danger'
        ? theme.state.danger
        : tone === 'onAccent'
          ? theme.text.onAccent
          : theme.text[tone]

  const styles = type[variant]
  return (
    <Text
      style={[
        {
          color,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          ...('letterSpacing' in styles ? { letterSpacing: styles.letterSpacing } : {}),
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  )
}

/** Titres de section, en capitales gravées. */
export function Inscription({ children, style, ...rest }: TextProps) {
  return (
    <Txt variant="display" style={[{ textTransform: 'uppercase' }, style]} {...rest}>
      {children}
    </Txt>
  )
}

/**
 * Logotype : le nom en capitales, doublé de sa translittération runique ᚲᚨᛁᚱᚾ.
 *
 * Les runes sont sous le mot et non à sa place. Un logotype illisible est un
 * logotype raté, et le lecteur d'écran comme le visiteur qui ne connaît pas le
 * futhark doivent tomber sur le nom écrit. La ligne runique est donc une
 * signature, pas une devinette : elle est masquée à l'accessibilité, le mot
 * au-dessus portant déjà l'information.
 */
export function Logotype({ style, ...rest }: ViewProps) {
  const { theme } = useTheme()
  return (
    <View style={[{ gap: space.xxs }, style]} {...rest}>
      <Inscription>Cairn</Inscription>
      <RuneRow
        runes={CAIRN}
        size={11}
        // Le gris atténué rendait la ligne sale plutôt que discrète, à cette
        // taille elle disparaissait presque. Le gris secondaire la pose sans
        // qu'elle concurrence le mot.
        color={theme.text.secondary}
        /**
         * Les deux lignes font la même largeur, à un pixel près.
         *
         * « CAIRN » mesure 69 points en Grenze 21 avec 3,2 d'interlettrage. Cinq
         * runes de 11 de haut occupent 5 × 6,6 = 33 points d'encre, il reste donc
         * 33 points à répartir sur quatre intervalles, soit 8. C'est mesuré, pas
         * estimé : changer `type.display` défait ce calage.
         */
        gap={8}
        // Sans cela la ligne s'étire sur toute la largeur du parent et le bloc
        // ne peut plus être centré comme un tout.
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  )
}

// ------------------------------------------------------------------ boutons

export function Button({
  label,
  variant = 'primary',
  busy = false,
  style,
  disabled,
  ...rest
}: PressableProps & { label: string; variant?: 'primary' | 'ghost' | 'danger'; busy?: boolean }) {
  const { theme } = useTheme()
  const inert = disabled || busy

  const background =
    variant === 'primary' ? theme.accent.default : variant === 'danger' ? 'transparent' : 'transparent'
  const border =
    variant === 'primary'
      ? theme.accent.default
      : variant === 'danger'
        ? theme.state.danger
        : theme.line.strong

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inert), busy }}
      disabled={inert}
      style={({ pressed }) => [
        {
          // Cible tactile de 48 points, plancher recommandé sur Android.
          minHeight: 48,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: pressed && variant === 'primary' ? theme.accent.pressed : border,
          backgroundColor:
            pressed && variant === 'primary'
              ? theme.accent.pressed
              : pressed
                ? theme.accent.subtle
                : background,
          opacity: inert ? 0.55 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      <Txt
        variant="label"
        tone={variant === 'primary' ? 'onAccent' : variant === 'danger' ? 'danger' : 'primary'}
      >
        {busy ? 'Un instant…' : label}
      </Txt>
    </Pressable>
  )
}

// -------------------------------------------------------------------- champs

/**
 * Creusé dans la roche : le champ est plus sombre que son environnement en thème
 * sombre, plus foncé que la neige en thème clair. L'anneau de focus utilise
 * l'accent, qui tient 3:1 sur les quatre strates.
 */
export function Field({
  label,
  hint,
  error,
  style,
  ...rest
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { theme } = useTheme()
  const { focused, onFocus, onBlur } = useFocusRing(rest)

  const borderColor = error
    ? theme.state.danger
    : focused
      ? theme.accent.default
      : theme.line.hairline

  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" tone="secondary">
        {label}
      </Txt>
      <TextInput
        style={[
          {
            minHeight: 48,
            backgroundColor: theme.surface.recessed,
            borderRadius: radius.md,
            borderWidth: focused ? 2 : 1,
            borderColor,
            paddingHorizontal: space.md,
            // Compense l'épaississement de la bordure au focus, sinon le texte
            // se décale d'un pixel à chaque entrée dans le champ.
            paddingVertical: focused ? space.sm - 1 : space.sm,
            color: theme.text.primary,
            fontFamily: type.body.fontFamily,
            fontSize: type.body.fontSize,
          },
          noWebOutline,
          style,
        ]}
        placeholderTextColor={theme.text.muted}
        {...rest}
        // Après le spread, pour que nos gestionnaires ne soient pas écrasés :
        // useFocusRing rappelle déjà ceux passés en props.
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------- tags

/**
 * Puce de couleur d'un tag. Non textuelle, donc auditée à 3:1 sur les quatre
 * strates. Le nom du tag reste écrit en couleur de texte : sur un fond teinté,
 * un libellé coloré perdrait en lisibilité pour ne rien apporter.
 */
export function TagDot({ colorKey, size = 8 }: { colorKey: Parameters<ReturnType<typeof useTheme>['tagColor']>[0]; size?: number }) {
  const { tagColor } = useTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tagColor(colorKey),
      }}
    />
  )
}
