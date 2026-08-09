import type { ColorValue } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/**
 * Pictogrammes fonctionnels que Feather ne fournit pas, tracés dans sa grille.
 *
 * Rien à voir avec les runes de src/ui/runes.tsx, qui sont ornementales et ne
 * portent jamais de sens : ceux-ci sont des icônes d'interface au même titre que
 * la corbeille, et se lisent comme telles.
 *
 * ── Pourquoi les dessiner plutôt qu'emprunter une autre famille ──────────────
 * MaterialCommunityIcons a bien un coffre, et @expo/vector-icons l'embarque
 * déjà. Mais son trait est plus gras et ses formes plus pleines : posé à côté
 * d'un `check-circle` de Feather dans la même barre, il ne se lit pas comme un
 * voisin, il se lit comme une pièce rapportée. Une icône de plus ne vaut pas de
 * casser l'unité d'une famille.
 *
 * La grille de Feather est reproductible : boîte de 24, trait de 2, extrémités
 * et jointures arrondies, aucun aplat. Les tracés ci-dessous s'y tiennent, et
 * l'épaisseur suit la taille demandée comme le fait Feather, sinon un glyphe
 * agrandi paraîtrait tracé plus finement que ses voisins.
 */

const BOX = 24

const GLYPHS = {
  /**
   * Coffre. Couvercle bombé, caisse aux angles bas adoucis, moraillon au centre.
   *
   * Le bombé n'est pas décoratif : une caisse à couvercle plat se confond avec
   * une boîte ou une archive, deux icônes déjà employées ailleurs dans
   * l'application. C'est la courbe qui fait le coffre.
   */
  chest: [
    // Couvercle : arc de (3,9) à (21,9), sommet à 4.
    'M3 9 a9 5 0 0 1 18 0',
    // Caisse : le bord haut sert de bandeau entre couvercle et corps.
    'M3 9 h18 v9 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z',
    // Moraillon, sous le bandeau.
    'M12 9 v4',
  ],

  /**
   * Barré. Construit exactement comme le `underline` de Feather — une arche
   * surmontée d'un trait — mais le trait passe au milieu au lieu de courir
   * dessous. C'est la seule différence, et c'est ce qui fait que les deux
   * boutons se lisent comme une paire dans la barre de mise en forme.
   */
  strikethrough: ['M6 4 v5 a6 6 0 0 0 12 0 V4', 'M4 11 h16'],

  /**
   * Grand titre et sous-titre : la même lettre à deux tailles.
   *
   * Un « H1 » et un « H2 » seraient plus précis et illisibles à seize points, la
   * hauteur du chiffre tombant sous le trait. Deux A de tailles différentes se
   * comprennent sans être déchiffrés, ce qui est le seul critère qui vaille pour
   * un pictogramme.
   */
  letterLarge: ['M4 20 L12 5 L20 20', 'M7.4 14 H16.6'],
  letterSmall: ['M7 19 L12 9 L17 19', 'M9.2 15.4 H14.8'],
} as const

export type GlyphName = keyof typeof GLYPHS

export const glyphNames = Object.keys(GLYPHS) as GlyphName[]

export function isGlyphName(name: string): name is GlyphName {
  return name in GLYPHS
}

export function Glyph({
  name,
  size = 20,
  color,
}: {
  name: GlyphName
  size?: number
  /**
   * `ColorValue` et non `string` : react-navigation passe la teinte de l'onglet
   * sous ce type, qui couvre aussi les couleurs opaques de plateforme. C'est
   * exactement ce que `react-native-svg` attend pour `stroke`, il n'y a donc
   * rien à convertir.
   */
  color: ColorValue
}) {
  // Feather trace à 2 unités sur une boîte de 24, quelle que soit la taille de
  // rendu : l'épaisseur apparente suit donc l'échelle, et le glyphe reste le
  // frère de ceux qui l'entourent.
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      {GLYPHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  )
}
