# Module: android-toolchain

A native Android app in Kotlin with Jetpack Compose: Gradle with a version
catalog and a checksummed wrapper, a JDK 21 toolchain, Spotless (ktlint),
detekt, Android Lint, Robolectric and Roborazzi, and signed release APKs
attached to GitHub Releases. One stack per repository.

## 1. Depends on

Nothing beyond core. It conflicts with `js-toolchain`, `python-toolchain`,
`web-app` and `cloudflare-opentofu` (`conflictsWith`).

## 2. Interview questions

- `application_id` (type `application_id`): the Android application id, a
  lower-case reverse domain such as `org.example.app`. It is the Kotlin
  package and the namespace too. Say that it can't change once anyone has a
  release installed, because Android treats a new id as a different app.
  Suggest one from a domain the owner controls; never a personal name.

**Plan warnings:**
- The Android SDK, Jetpack, Android Lint and Robolectric are Google's, and
  Google is on both BDS lists. The screening rows record them as allowed
  under the free-tool exception: nothing is paid and there is no Google Play
  listing.
- Releases are signed with an upload key that only the owner holds. Losing
  it means existing installs can't update to a new release; say that the
  manual step includes keeping an offline backup.

## 3. Files

- Tooling (initial commit): `settings.gradle.kts`, `build.gradle.kts`
  (Spotless with the ktlint rules, detekt), `gradle.properties`,
  `gradle/libs.versions.toml`, the Gradle wrapper (`gradlew`, `gradlew.bat`,
  `gradle/wrapper/`), `.editorconfig`, `config/detekt/detekt.yml`,
  `core/build.gradle.kts` (pure Kotlin, explicit API, Android Lint),
  `app/build.gradle.kts` (Compose, `minSdk` 26, `targetSdk` 36, `compileSdk`
  37, R8, lint, Robolectric, Roborazzi, signing from environment variables,
  `versionName` and `versionCode` from `-PappVersion`),
  `app/proguard-rules.pro`, `.github/workflows/test.yml` (one `check` job
  running `./gradlew check`), `.github/workflows/release-artefacts.yml` (when
  a release is published, builds the signed APK in the `release`
  environment, verifies its signature and attaches it as
  `<slug>-<version>.apk`), `.github/dependabot.yml` (replaces core's, adding
  the `gradle` ecosystem, which covers the version catalog and the wrapper).
- Application (first PR, `stage: app`): `app/src/main/AndroidManifest.xml`
  (no permissions, backups off, only the launcher activity exported),
  the resources (name, theme, adaptive launcher icon, backup and
  data-extraction rules), `MainActivity.kt` with the greeting screen,
  `core/.../Greeting.kt` and its unit test, and
  `app/src/test/.../GreetingScreenTest.kt` (a Robolectric Compose test with
  accessibility checks, and Roborazzi screenshots in light and dark themes
  and at 2× font scale).

`compileSdk` is 37 because the current Compose libraries require it;
`targetSdk` stays at 36. The initial stage doesn't build on its own (it has no
manifest until the app stage), so `test.yml` runs on pull requests only, as
in the other stacks.

`gradlew` is rendered executable. Use the derived keys `name_kotlin`,
`greeting_kotlin` (Kotlin string literals), `name_android` (a string
resource) and `application_id_path` (the id as a directory path).

**Scaffold:** with `<dir>` as the working directory, `JAVA_HOME` set to a
JDK 21 and `ANDROID_HOME` to the SDK.

1. Before committing the initial stage, check that the template is still
   current: the newest stable AGP, Kotlin, Compose BOM and the other catalog
   entries (Google's Maven and Maven Central `maven-metadata.xml`), and the
   newest Gradle release (`https://services.gradle.org/versions/current`).
   If the template is behind, raise it for the plugin's own PR process;
   Dependabot moves them after bootstrap.
2. After rendering the app stage, record the screenshot references and look
   at each one before committing them:

   ```bash
   ./gradlew recordRoborazziDebug
   ```

   Commit `app/src/test/screenshots/*.png` with the app stage. Record on
   Linux x86-64, the platform CI runs on, so the references match.

## 4. GitHub configuration

After core's configuration. Step `github:android-toolchain:1`.

1. The `release` environment, limited to tags `v*`, so only a release can
   read the signing secrets:
   `gh api -X PUT repos/$R/environments/release --input -` with
   `{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}`,
   then
   `gh api -X POST repos/$R/environments/release/deployment-branch-policies -f name='v*' -f type=tag`.

   **Verify straight after creating it.** Both must pass:
   - `gh api repos/$R/environments/release --jq '.deployment_branch_policy'`
     prints `{"custom_branch_policies":true,"protected_branches":false}`;
   - `gh api repos/$R/environments/release/deployment-branch-policies --jq '[.branch_policies[] | "\(.type):\(.name)"]'`
     prints `["tag:v*"]`.

   **Fallback, only if the create or a verification fails** (typically a free
   private repository): record the step skipped with
   `node scripts/state.mjs skip <dir> github:android-toolchain:1 "environment branch policy not available: <what failed>"`,
   record it for the secrets script with
   `node scripts/state.mjs record <dir> skipped_envs release`,
   remove the `environment: release` line from `release-artefacts.yml` on the
   first PR's branch, set the secrets at repository level (the manual step
   says how), and add a row to `docs/threat-model.md`'s STRIDE table: threat
   "Any workflow on any branch can read the release signing key", category
   Elevation of privilege, mitigation "Environment branch policies weren't
   available on this repository when it was bootstrapped; upgrade the plan
   and move these secrets into the `release` environment", status Accepted.
   Offer the plan upgrade and let the user choose.

## 5. Manual steps

### android-toolchain:1 Create the upload key and set the signing secrets

**Why:** the release workflow can't sign the APK without it, and Android
only installs an update signed with the same key as the installed app.

**Do:** run
`node <skill dir>/scripts/secrets.mjs android-keystore <project dir>`. It
makes the keystore with a random password, stores both in Proton Pass and
sets the four secrets. Then make an offline backup of the keystore from the
Pass item: if it's lost, existing installs can't update.

**By hand:** on your own machine, never in the conversation:
1. Create the keystore outside the repository, with a strong password you
   keep in your password manager:
   `keytool -genkeypair -v -keystore <slug>-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`
   For the distinguished name, the project name is enough; no personal
   details are needed.
2. Keep an offline backup of the keystore and its password. If it's lost,
   existing installs can't update.
3. Set the four secrets in the `release` environment:
   - `base64 -w0 <slug>-upload.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo $R --env release`
     (on macOS, `base64 -i <slug>-upload.jks`)
   - `gh secret set ANDROID_KEYSTORE_PASSWORD --repo $R --env release`
   - `gh secret set ANDROID_KEY_ALIAS --repo $R --env release --body upload`
   - `gh secret set ANDROID_KEY_PASSWORD --repo $R --env release`
     (the same password unless you set a separate key password)

If github:android-toolchain:1 was skipped (its fallback), drop
`--env release` and set them at repository level.

**Verify (Claude runs):** `gh secret list --repo $R --env release`.
**Expected:** all four names listed. The key itself is checked when the first
release is signed (below).

### android-toolchain:2 Check the signed APK (after the first PR)

**Why:** proves the signing secrets work and the published APK is signed
with the upload key.

**Do:** nothing by hand.

**Verify (Claude runs):** `gh run list --repo $R --workflow release-artefacts.yml --limit 1`
shows success, and `gh release view v0.1.0 --repo $R --json assets --jq '[.assets[].name]'`
lists `<slug>-0.1.0.apk`. Then ask the user to compare the signer's SHA-256
digest in that run's log (`apksigner verify --print-certs`) with
`keytool -list -v -keystore <slug>-upload.jks -alias upload` on their own
machine.
**Expected:** success, the APK is attached, and the digests match.

## 6. Standards

`templates/standards-fragment.md`, rendered as "Android toolchain".

## 7. Smoke check

On the full render, in a temporary directory with `git init` and
`git add -A` done, `JAVA_HOME` at a JDK 21 and `ANDROID_HOME` at the SDK:
`./gradlew recordRoborazziDebug && ./gradlew check assemble`. Both exit 0.
Look at the three recorded screenshots. `assemble` builds an unsigned release
APK when no keystore is configured.
