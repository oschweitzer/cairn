import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { WidgetSnapshot } from '../../src/widget/snapshot'

/**
 * Bridge to the Android widget.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: on the web
 * and inside Expo Go the native module does not exist. A required lookup would
 * throw while the JavaScript module loads — that is, as the PWA starts — for a
 * feature that makes no sense there anyway.
 */
type CairnWidgetNativeModule = {
  /** Writes the snapshot and asks the launcher to redraw the placed widgets. */
  setSnapshot(json: string): void
  /** How many widgets are currently placed on a home screen. */
  widgetCount(): number
}

const native = requireOptionalNativeModule<CairnWidgetNativeModule>('CairnWidget')

/** True when a widget can exist at all: Android, and a native build. */
export const widgetAvailable = Platform.OS === 'android' && native !== null

export function setWidgetSnapshot(snapshot: WidgetSnapshot): void {
  if (!native) return
  native.setSnapshot(JSON.stringify(snapshot))
}

/**
 * How many widgets are placed.
 *
 * Used to avoid writing the snapshot when nobody will read it: serialising it on
 * every keystroke for a home screen that carries none would be wasted work, and
 * more importantly notes copied into the preference store for no reason.
 */
export function placedWidgetCount(): number {
  return native?.widgetCount() ?? 0
}
