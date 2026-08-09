const { withDangerousMod } = require('expo/config-plugins')
const { copyFileSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Pose les couleurs du thème là où le widget peut les lire.
 *
 * Les mises en page du widget sont du XML Android : elles ne peuvent pas
 * importer src/ui/theme.ts, et une `RemoteViews` ne sait pas résoudre une
 * ressource par un nom calculé. Il leur faut donc de vraies ressources de
 * couleur, dans le paquet de l'application.
 *
 * `scripts/gen-theme.ts` les produit déjà, dans generated/. Ce plugin ne fait
 * que les recopier au moment de la génération du projet natif, ce qui garde une
 * seule source : une teinte modifiée dans theme.ts se propage au widget par
 * `npm run theme`, et `npm run theme:check` échoue si l'on oublie.
 *
 * Le module aurait pu embarquer sa propre copie de ces XML — une bibliothèque
 * Android peut avoir ses ressources. Ce serait une seconde copie à tenir à jour,
 * et le générateur n'en connaîtrait qu'une.
 */
const withWidgetColors = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const root = mod.modRequest.projectRoot
      const res = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')

      const copies = [
        ['colors.xml', 'values'],
        ['colors-night.xml', 'values-night'],
      ]

      for (const [file, folder] of copies) {
        const from = join(root, 'generated', file)
        if (!existsSync(from)) {
          throw new Error(
            `generated/${file} est absent. Lancer \`npm run theme\` avant de générer le projet natif : ` +
              'le widget Android lit ses couleurs depuis ces ressources.',
          )
        }
        const to = join(res, folder)
        mkdirSync(to, { recursive: true })
        copyFileSync(from, join(to, 'colors.xml'))
      }

      return mod
    },
  ])

module.exports = withWidgetColors
