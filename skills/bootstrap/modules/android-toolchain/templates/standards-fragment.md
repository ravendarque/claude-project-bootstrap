### Android toolchain

Platform persona for this stack: the activity and process lifecycle,
configuration changes and state restoration, what the app exposes to other
apps, what leaves the device, accessibility across font scales and themes,
and the APK's size and startup.

- **One entry point.** `./gradlew check` runs Spotless (ktlint), detekt,
  Android Lint, the unit and Robolectric tests, the Roborazzi screenshot
  comparison and a release build with R8. CI runs exactly that. Run it before
  pushing.
- **Versions live in `gradle/libs.versions.toml`**, and the Gradle wrapper
  pins its distribution by checksum. Dependabot updates both. Build scripts
  never hard-code a version, and every repository is declared once in
  `settings.gradle.kts`.
- **JDK 21 toolchain.** Gradle compiles with a JDK 21 toolchain whatever JDK
  runs it, so CI and development produce the same bytecode.
- **Two modules.** `:core` is pure Kotlin with no Android dependency: put
  logic there and test it with plain unit tests. `:app` holds the Android
  and Compose code. `:core` uses explicit API mode.
- **Format with ktlint through Spotless** (`./gradlew spotlessApply`), in
  the `ktlint_official` style. The ktlint rules are set in the root
  `build.gradle.kts`, because Spotless doesn't read `.editorconfig` for them.
  detekt runs with its default rules plus `config/detekt/detekt.yml`.
  Compiler warnings are errors.
- **Lint warnings are errors**, and the accessibility and security checks
  are errors in their own right. The checks that only say a newer version
  exists are off, because a new upstream release must not fail an unrelated
  PR. Don't suppress a lint issue without a comment saying why.
- **Test UI with Robolectric and Compose's test APIs** on the JVM, with
  accessibility checks on (`enableAccessibilityChecks()`). Screenshot tests
  use Roborazzi; the reference images live in `app/src/test/screenshots`.
  When a UI change is intended, run `./gradlew recordRoborazziDebug`, look at
  every changed image, and commit them with the change. Screenshot the light
  and dark themes and a large font scale.
- **Nothing leaves the device unless a decision says so.** The template has
  no `INTERNET` permission, and adding one (or any other permission) needs an
  ADR and an update to the threat model and record of processing. Backups
  and device transfer exclude all app data.
- **Never log user content**, at any level, in any build type. Log events
  and error types, not what the user wrote, said or captured.
- **Export nothing but the launcher activity.** Every other component sets
  `android:exported="false"`; a library component that would be exported is
  removed in the manifest with `tools:node="remove"`. Check the merged
  release manifest when a dependency changes.
- **Release builds** are minified and shrunk with R8 and signed with the
  upload key from the `release` environment's secrets. `versionName` is the
  release tag without its `v` and `versionCode` is
  `major × 1,000,000 + minor × 1,000 + patch`, so each part stays below
  1,000. Nothing reads a version from a file; local builds are `0.0.0`. A
  keystore never enters the repository.
- **Verifying on Android** replaces "drive it in a browser": run the change
  on an emulator (or a device), in the light and dark themes and at the
  largest font scale, with TalkBack on for anything interactive.
- **detekt 1.23** is the current stable line. It uses Gradle APIs that
  Gradle 10 removes, so move to detekt 2 once it's stable.
