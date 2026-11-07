import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render, resolveModules, validateAnswers } from "../skills/bootstrap/scripts/render.mjs";
import { brokenLinks, files, realModulesDir, renderReal } from "./helpers.mjs";

const answers = { application_id: "org.example.sample" };
const dest = renderReal(["android-toolchain"], answers);
const read = path => readFileSync(join(dest, path), "utf8");

test("android-toolchain can't be combined with another stack", () => {
  for (const other of ["js-toolchain", "python-toolchain", "web-app", "cloudflare-opentofu"]) {
    assert.throws(() => resolveModules(["android-toolchain", other], realModulesDir), /^Error: Conflicting modules: /, other);
    assert.throws(() => resolveModules([other, "android-toolchain"], realModulesDir), /^Error: Conflicting modules: /, other);
  }
});

test("the initial stage ships the build, and the app stage the manifest, code and tests", () => {
  const all = [...files(dest)];
  for (const path of [
    "settings.gradle.kts",
    "gradle/libs.versions.toml",
    "gradlew",
    "app/src/main/AndroidManifest.xml",
    "app/src/main/kotlin/org/example/sample/MainActivity.kt",
    "core/src/main/kotlin/org/example/sample/core/Greeting.kt",
    "core/src/test/kotlin/org/example/sample/core/GreetingTest.kt",
    "app/src/test/kotlin/org/example/sample/GreetingScreenTest.kt",
  ]) {
    assert.ok(all.includes(path), path);
  }
  const { answers: full } = validateAnswers({ name: "Sample Project", description: "x", owner: "o", visibility: "public", ...answers });
  const modules = resolveModules(["android-toolchain"], realModulesDir);
  const initial = render({ modules, answers: full, modulesDir: realModulesDir, destDir: mkdtempSync(join(tmpdir(), "android-")), stage: "initial" });
  assert.ok(initial.includes("app/build.gradle.kts"));
  assert.ok(!initial.some(path => path.startsWith("app/src/") || path.startsWith("core/src/")));
});

test("the Gradle wrapper is the published jar, executable, and pinned by checksum", () => {
  const jar = readFileSync(join(dest, "gradle/wrapper/gradle-wrapper.jar"));
  assert.equal(jar.subarray(0, 2).toString("latin1"), "PK");
  assert.equal(createHash("sha256").update(jar).digest("hex"), "3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98");
  assert.ok(statSync(join(dest, "gradlew")).mode & 0o100);
  const properties = read("gradle/wrapper/gradle-wrapper.properties");
  assert.match(properties, /^distributionSha256Sum=[0-9a-f]{64}$/m);
  assert.match(properties, /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[\d.]+-bin\.zip$/m);
});

test("versions live only in the catalog", () => {
  const catalog = read("gradle/libs.versions.toml");
  for (const key of ["agp", "kotlin", "compose-bom", "robolectric", "roborazzi", "spotless", "ktlint", "detekt"]) {
    assert.match(catalog, new RegExp(`^${key} = "[\\d.]+"$`, "m"), key);
  }
  for (const script of ["build.gradle.kts", "app/build.gradle.kts", "core/build.gradle.kts", "settings.gradle.kts"]) {
    assert.doesNotMatch(read(script), /["'][\w.-]+:[\w.-]+:\d/, script);
  }
});

test("the app is pinned to its SDK levels and identified by the answer", () => {
  const app = read("app/build.gradle.kts");
  assert.match(app, /^ {4}namespace = "org\.example\.sample"$/m);
  assert.match(app, /^ {8}applicationId = "org\.example\.sample"$/m);
  assert.match(app, /^ {8}minSdk = 26$/m);
  assert.match(app, /^ {8}targetSdk = 36$/m);
  assert.match(app, /^ {4}compileSdk = 37$/m);
  assert.match(app, /isMinifyEnabled = true/);
  assert.match(app, /warningsAsErrors = true/);
  assert.match(app, /jvmToolchain\(21\)/);
  assert.match(read("core/build.gradle.kts"), /jvmToolchain\(21\)/);
});

test("the version comes from the release tag, never from a file", () => {
  const app = read("app/build.gradle.kts");
  assert.match(app, /providers\.gradleProperty\("appVersion"\)\.orElse\("0\.0\.0"\)/);
  assert.match(app, /versionCode = \(appMajor \* 1_000_000 \+ appMinor \* 1_000 \+ appPatch\)\.coerceAtLeast\(1\)/);
  const release = read(".github/workflows/release-artefacts.yml");
  assert.match(release, /-PappVersion="\$\{TAG#v\}"/);
  assert.doesNotMatch(read("gradle.properties"), /version/i);
});

test("the manifest asks for no permissions and exports only the launcher activity", () => {
  const manifest = read("app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(manifest, /uses-permission/);
  assert.equal(manifest.match(/android:exported="true"/g).length, 1);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /ProfileInstallReceiver"\n(\s+tools:\w+="\w+"\n)*\s+tools:node="remove"/);
});

test("the greeting and the app name are escaped for Kotlin and Android resources", () => {
  const tricky = renderReal(["android-toolchain"], { ...answers, name: `Sam's "$App"` });
  const text = path => readFileSync(join(tricky, path), "utf8");
  assert.match(text("app/src/main/res/values/strings.xml"), /<string name="app_name">Sam\\'s \\"\$App\\"<\/string>/);
  assert.ok(text("core/src/test/kotlin/org/example/sample/core/GreetingTest.kt").includes(String.raw`assertEquals("Hello from Sam's \"\$App\"", greeting("Sam's \"\$App\""))`));
});

test("CI runs exactly the Gradle check, with pinned actions and the open-source cache", () => {
  const ci = read(".github/workflows/test.yml");
  assert.match(ci, /^ {2}check:$/m);
  assert.match(ci, /runs-on: ubuntu-26\.04$/m);
  assert.match(ci, /persist-credentials: false/);
  for (const [, ref] of ci.matchAll(/uses: (\S+)/g)) assert.match(ref, /@[0-9a-f]{40}$/);
  assert.deepEqual([...ci.matchAll(/^\s+- run: (.*)$/gm)].map(m => m[1]), ["./gradlew check"]);
  assert.match(ci, /cache-provider: basic/);
  assert.match(ci, /validate-wrappers: true/);
  assert.match(ci, /java-version: "21"/);
  const app = read("app/build.gradle.kts");
  assert.match(app, /dependsOn\("verifyRoborazziDebug", "assembleRelease"\)/);
  assert.match(read("build.gradle.kts"), /dependsOn\("spotlessCheck", "detekt"\)/);
});

test("the release workflow signs in the release environment and attaches the APK", () => {
  const release = read(".github/workflows/release-artefacts.yml");
  assert.match(release, /release:\n\s+types: \[published\]/);
  assert.match(release, /environment: release/);
  assert.match(release, /cache-disabled: true/);
  for (const secret of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
    assert.match(release, new RegExp(`\\$\\{\\{ secrets\\.${secret} \\}\\}`), secret);
  }
  assert.match(release, /apksigner" verify --print-certs/);
  assert.match(release, /apk="sample-project-\$\{TAG#v\}\.apk"/);
  assert.match(release, /gh release upload "\$TAG" "\$apk"/);
  assert.doesNotMatch(release, /play|fastlane/i);
});

test("the ruleset requires the check job", () => {
  const ruleset = JSON.parse(read(".bootstrap/github/ruleset.json"));
  const checks = ruleset.rules.find(r => r.type === "required_status_checks").parameters.required_status_checks;
  assert.deepEqual(checks.map(c => c.context), ["check-label", "check"]);
});

test("dependabot covers gradle and actions with core's cooldown", () => {
  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem: "gradle"/);
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.equal(dependabot.match(/default-days: 3/g).length, 2);
});

test("the coding standards gain the Android section, which redefines browser verification", () => {
  const standards = read("docs/coding-standards.md");
  assert.match(standards, /### Android toolchain/);
  assert.match(standards, /emulator .*\n?.*light and dark themes/);
  assert.match(standards, /Never log user content/);
  assert.match(read("CLAUDE.md"), /Run `\.\/gradlew check` before pushing/);
});

test("the screening table lists every new dependency and vendor", () => {
  const table = read("docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md");
  for (const name of ["Android SDK", "Robolectric", "Kotlin", "Gradle", "Eclipse Temurin", "Roborazzi", "ktlint", "detekt", "Spotless", "JUnit 4"]) {
    assert.ok(table.includes(`| ${name}`), name);
  }
  assert.match(table, /\| Robolectric \| [^|]+ \| Y \|/);
});

test("no node or python tooling is rendered", () => {
  assert.ok(!existsSync(join(dest, "package.json")));
  assert.ok(!existsSync(join(dest, "pyproject.toml")));
});

test("links resolve", () => {
  assert.deepEqual(brokenLinks(dest), []);
});
