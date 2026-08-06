import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/**
 * Iconographie runique. Ornementale, jamais fonctionnelle.
 *
 * ── Pourquoi du vectoriel et pas du texte ────────────────────────────────────
 * Le bloc Runique d'Unicode (U+16A0 à U+16FF) existe, mais presque aucune police
 * système ne le couvre : ni Roboto sur Android, ni la pile par défaut des
 * navigateurs. Un `<Text>ᚱ</Text>` afficherait donc un rectangle vide sur la
 * grande majorité des appareils, et le vérifier sur le sien ne prouve rien. Les
 * runes sont donc tracées, ce qui a un bénéfice secondaire : l'épaisseur du
 * trait suit la couleur et la taille demandées, comme un vrai burin.
 *
 * ── Pourquoi elles ne portent jamais de sens ─────────────────────────────────
 * Le principe posé au départ tient toujours : le caractère passe par les
 * surfaces, la couleur, la typographie et le mouvement, et les affordances
 * restent conventionnelles. Une rune ne remplace donc jamais une icône que l'on
 * doit comprendre pour agir. Une case à cocher reste une case à cocher, la
 * corbeille garde son icône de corbeille. Les runes marquent, elles n'indiquent
 * pas. Elles sont par conséquent toutes masquées aux lecteurs d'écran.
 *
 * ── Géométrie ────────────────────────────────────────────────────────────────
 * Chaque rune est décrite dans une boîte de 12 sur 20 unités, en traits droits
 * uniquement, ce qui est la définition même de l'alphabet : le futhark est
 * anguleux parce qu'il a été taillé au couteau dans le bois et à la pointe dans
 * la pierre, où une courbe est difficile et suit le fil du support. Les
 * extrémités sont carrées pour la même raison.
 */

/** Futhark ancien, sous-ensemble réellement utilisé dans l'interface. */
const PATHS = {
  // ᚠ fehu
  fehu: 'M2 0 V20 M2 4 L9 1 M2 10 L9 7',
  // ᚢ uruz
  uruz: 'M2 20 V2 L9 6 V20',
  // ᚦ thurisaz
  thurisaz: 'M2 0 V20 M2 5 L8 9 L2 13',
  // ᚨ ansuz
  ansuz: 'M2 0 V20 M2 2 L8 6 M2 8 L8 12',
  // ᚱ raido
  raido: 'M2 0 V20 M2 1 L9 5 L2 10 M2 10 L8 19',
  // ᚲ kaunan
  kaunan: 'M9 1 L2 10 L9 19',
  // ᚷ gebo
  gebo: 'M1 1 L11 19 M11 1 L1 19',
  // ᚹ wunjo
  wunjo: 'M2 0 V20 M2 1 L9 5 L2 10',
  // ᚺ hagalaz
  hagalaz: 'M2 0 V20 M10 0 V20 M2 8 L10 12',
  // ᚾ naudiz
  naudiz: 'M6 0 V20 M1 13 L11 7',
  // ᛁ isaz
  isaz: 'M6 0 V20',
  // ᛉ algiz
  algiz: 'M6 20 V5 M6 5 L1 0 M6 5 L11 0',
  // ᛊ sowilo
  sowilo: 'M9 1 L3 7 L9 13 L3 19',
  // ᛏ tiwaz
  tiwaz: 'M6 20 V2 M1 8 L6 2 L11 8',
  // ᛒ berkanan
  berkanan: 'M2 0 V20 M2 1 L9 5 L2 9 M2 10 L9 15 L2 19',
  // ᛖ ehwaz
  ehwaz: 'M2 20 V3 L6 8 L10 3 V20',
  // ᛗ mannaz
  mannaz: 'M2 0 V20 M10 0 V20 M2 2 L10 10 M10 2 L2 10',
  // ᛚ laguz
  laguz: 'M2 0 V20 M2 1 L8 7',
  // ᛜ ingwaz
  ingwaz: 'M6 3 L11 10 L6 17 L1 10 Z',
  // ᛞ dagaz
  dagaz: 'M2 19 L2 1 L10 19 L10 1 Z',
  // ᛟ othala
  othala: 'M6 1 L11 7 L6 13 L1 7 Z M4 11 L1 19 M8 11 L11 19',
} as const

export type RuneName = keyof typeof PATHS

export const runeNames = Object.keys(PATHS) as RuneName[]

/**
 * « Cairn » translittéré en futhark ancien : ᚲᚨᛁᚱᚾ.
 *
 * Le futhark n'a pas de C, le son dur passe par kaunan. La translittération est
 * donc K-A-I-R-N, ce qui se lit correctement à voix haute et n'invente rien.
 */
export const CAIRN: readonly RuneName[] = ['kaunan', 'ansuz', 'isaz', 'raido', 'naudiz']

const BOX_W = 12
const BOX_H = 20

/**
 * Géométrie brute, pour les rendus qui ne peuvent pas passer par `<Rune>` :
 * la gravure sur la pierre levée plus bas, et l'attente animée de
 * src/ui/RuneLoader.tsx, dont le trait change de couleur et doit donc être un
 * chemin animé plutôt qu'un chemin ordinaire.
 *
 * Le tracé reste défini ici, en un seul endroit. Le recopier ailleurs le
 * laisserait dériver à la première retouche.
 */
export const runeBox = { width: BOX_W, height: BOX_H } as const

export function runePath(name: RuneName): string {
  return PATHS[name]
}

/**
 * Une rune. `size` est la hauteur souhaitée, la largeur en découle.
 *
 * L'épaisseur du trait suit la taille par défaut, sinon une rune agrandie
 * paraîtrait gravée avec une pointe de plus en plus fine.
 */
export function Rune({
  name,
  size = 14,
  color,
  strokeWidth,
}: {
  name: RuneName
  size?: number
  color: string
  strokeWidth?: number
}) {
  const width = (size * BOX_W) / BOX_H
  const stroke = strokeWidth ?? Math.max(1.25, size / 11)

  return (
    <Svg
      width={width}
      height={size}
      // La marge d'une unité empêche le trait d'être rogné sur les bords de la
      // boîte, où passent plusieurs runes.
      viewBox={`-1 -1 ${BOX_W + 2} ${BOX_H + 2}`}
    >
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
    </Svg>
  )
}

/**
 * Une suite de runes sur une ligne, masquée aux lecteurs d'écran.
 *
 * L'appelant fournit `label` quand le mot runique remplace visuellement un texte
 * lisible, pour que la ligne reste annoncée. Sans `label`, l'ensemble est
 * purement décoratif et disparaît de l'arbre d'accessibilité.
 */
export function RuneRow({
  runes,
  size = 14,
  color,
  gap,
  label,
  style,
}: {
  runes: readonly RuneName[]
  size?: number
  color: string
  gap?: number
  label?: string
  style?: React.ComponentProps<typeof View>['style']
}) {
  const spacing = gap ?? Math.round(size * 0.42)

  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing }, style]}
    >
      {runes.map((name, i) => (
        <Rune key={`${name}-${i}`} name={name} size={size} color={color} />
      ))}
    </View>
  )
}

/**
 * Pierre levée gravée, pour les écrans vides.
 *
 * Elle remplace l'icône Feather qui tenait ce rôle : un pictogramme d'interface
 * au milieu d'un écran vide est un panneau « il n'y a rien », alors qu'une
 * pierre debout est l'objet même que l'application empile. La silhouette est
 * volontairement irrégulière, une pierre dressée n'est pas un rectangle.
 */
export function StandingStone({
  size = 72,
  color,
  carveColor,
  runes = ['algiz', 'isaz'],
}: {
  size?: number
  /** Contour de la pierre. */
  color: string
  /** Gravure, en général l'accent. */
  carveColor: string
  runes?: readonly RuneName[]
}) {
  // Boîte de 60 sur 84, la pierre occupe 44 de large et laisse le socle respirer.
  const width = (size * 60) / 84

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={size} viewBox="0 0 60 84">
        {/**
         * Silhouette : large à la base, effilée vers le haut, sommet de guingois.
         *
         * Le sens de l'évasement n'est pas un détail de goût. Une forme plus
         * étroite en bas qu'au milieu se lit immédiatement comme un cercueil,
         * ce qu'a donné le premier tracé. Une pierre plantée fait l'inverse :
         * elle est massive au sol et s'amincit en montant, et ses deux flancs ne
         * sont pas symétriques.
         */}
        <Path
          d="M13 80 L16 52 L18 28 L24 10 L33 5 L40 16 L43 44 L46 80 Z"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="miter"
          fill="none"
        />
        {/* Ligne de sol, plus courte que la base : la pierre est plantée. */}
        <Path d="M8 80 H52" stroke={color} strokeWidth={2} strokeLinecap="square" />
        {/* Gravure, centrée sur la face. */}
        <CarvedRunes runes={runes} color={carveColor} />
      </Svg>
    </View>
  )
}

/**
 * Runes gravées sur la face de la pierre. Extrait pour garder `StandingStone`
 * lisible, et parce que la mise en colonne n'a rien à voir avec la silhouette.
 */
function CarvedRunes({ runes, color }: { runes: readonly RuneName[]; color: string }) {
  const height = 13
  const total = runes.length * height + (runes.length - 1) * 5
  // Centrées sur la partie basse de la face, pas sur la boîte : le haut de la
  // pierre est trop étroit pour accueillir une gravure sans la serrer.
  const top = 46 - total / 2

  return (
    <>
      {runes.map((name, i) => {
        const y = top + i * (height + 5)
        const scale = height / BOX_H
        // Chaque rune est ramenée dans le repère de la pierre par une
        // transformation, plutôt que par un recalcul des chemins.
        return (
          <Path
            key={`${name}-${i}`}
            d={PATHS[name]}
            transform={`translate(${30 - (BOX_W * scale) / 2} ${y}) scale(${scale})`}
            stroke={color}
            strokeWidth={2 / scale}
            strokeLinecap="square"
            strokeLinejoin="miter"
            fill="none"
          />
        )
      })}
    </>
  )
}
