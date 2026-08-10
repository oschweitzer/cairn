// @ts-check

const { withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')

/**
 * Pins the Gradle daemon to Java 21, on every prebuild.
 *
 * ── What breaks without this ─────────────────────────────────────────────────
 * The Android template ships `gradle/gradle-daemon-jvm.properties` asking for
 * Java 25. Gradle honours that file above everything else — above `JAVA_HOME`,
 * above `-Dorg.gradle.java.home`, above Android Studio's own Gradle JDK setting
 * — and downloads a JDK 25 if the machine has none. So the daemon runs on 25.
 *
 * The Android Gradle Plugin then runs `prefab` in a JVM of that version to lay
 * out the native dependencies of any module carrying C++ — react-native-worklets
 * and react-native-screens, here. From Java 24 a restricted call such as
 * `System.loadLibrary` prints a warning on stderr, and AGP re-reads that stream
 * line by line treating anything it does not recognise as fatal. The build dies
 * on `configureCMakeDebug` with the warning's own text as the error message:
 *
 *     Execution failed for task ':react-native-screens:configureCMakeDebug[…]'.
 *     > WARNING: A restricted method in java.lang.System has been called
 *
 * Nothing in the project is at fault, and the message names no file of ours,
 * which is what makes it expensive to diagnose a second time.
 *
 * ── Why a plugin and not an edit ─────────────────────────────────────────────
 * `android/` is generated and git-ignored: an edit made there survives until the
 * next `expo prebuild --clean` and no further. The plugin puts the decision in
 * the tracked source, where it is applied again every time the native project is
 * regenerated.
 *
 * The download URLs the template writes alongside the version are dropped: they
 * point at Java 25 builds, and keeping them would hand Gradle the means to
 * re-provision exactly what we are avoiding. Gradle falls back to the JDKs
 * already installed on the machine, which is what we want it to use.
 *
 * Raise this the day AGP stops parsing that stream so strictly, or the day the
 * template's own version stops tripping it.
 */
const JAVA_VERSION = 21

const CONTENTS = `#Written by plugins/withGradleDaemonJvm.js on every prebuild.
#Java ${JAVA_VERSION} and not the template's 25: AGP re-reads prefab's stderr and
#treats Java 24+'s restricted-call warning as a fatal error. See the plugin.
toolchainVersion=${JAVA_VERSION}
`

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withGradleDaemonJvm = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const file = path.join(
        config.modRequest.platformProjectRoot,
        'gradle',
        'gradle-daemon-jvm.properties',
      )

      // `mkdir` first: the mod also has to hold when the template stops shipping
      // the file, in which case its directory may not be there either.
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, CONTENTS)

      return config
    },
  ])

module.exports = withGradleDaemonJvm
