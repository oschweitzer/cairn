import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { WidgetSnapshot } from '../../src/widget/snapshot'

/**
 * Pont vers le widget Android.
 *
 * `requireOptionalNativeModule` et non `requireNativeModule` : sur le web et
 * dans Expo Go, le module natif n'existe pas. Un accès obligatoire y lèverait au
 * chargement du module JavaScript, c'est-à-dire au démarrage de la PWA, pour une
 * fonctionnalité qui n'y a de toute façon aucun sens.
 */
type CairnWidgetNativeModule = {
  /** Écrit l'instantané et demande au lanceur de redessiner les widgets posés. */
  setSnapshot(json: string): void
  /** Nombre de widgets actuellement posés sur un écran d'accueil. */
  widgetCount(): number
}

const native = requireOptionalNativeModule<CairnWidgetNativeModule>('CairnWidget')

/** Vrai quand un widget peut exister : Android, et build natif. */
export const widgetAvailable = Platform.OS === 'android' && native !== null

export function setWidgetSnapshot(snapshot: WidgetSnapshot): void {
  if (!native) return
  native.setSnapshot(JSON.stringify(snapshot))
}

/**
 * Combien de widgets sont posés.
 *
 * Sert à ne pas écrire l'instantané quand personne ne le lira : le sérialiser à
 * chaque frappe pour un écran d'accueil qui n'en porte aucun serait du travail
 * pur perte, et surtout des notes recopiées dans les préférences sans raison.
 */
export function placedWidgetCount(): number {
  return native?.widgetCount() ?? 0
}
