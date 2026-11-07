plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

val appVersion = providers.gradleProperty("appVersion").orElse("0.0.0").get()
val appVersionParts =
    requireNotNull(Regex("""(\d{1,3})\.(\d{1,3})\.(\d{1,3})""").matchEntire(appVersion)) {
        "appVersion must be X.Y.Z with each part 0-999, not $appVersion"
    }.destructured.toList().map(String::toInt)
val (appMajor, appMinor, appPatch) = appVersionParts

val releaseKeystore = providers.environmentVariable("ANDROID_KEYSTORE_PATH")

android {
    namespace = "{{application_id}}"
    compileSdk = 37

    defaultConfig {
        applicationId = "{{application_id}}"
        minSdk = 26
        targetSdk = 36
        versionName = appVersion
        versionCode = (appMajor * 1_000_000 + appMinor * 1_000 + appPatch).coerceAtLeast(1)
    }

    signingConfigs {
        if (releaseKeystore.isPresent) {
            create("release") {
                storeFile = file(releaseKeystore.get())
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Robolectric reaches into JDK internals: https://robolectric.org/getting-started/
        unitTests.all {
            it.jvmArgs(
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.security=ALL-UNNAMED",
                "--add-opens=java.base/java.text=ALL-UNNAMED",
                "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                "--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
                "--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
            )
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkDependencies = true
        checkReleaseBuilds = true
        error +=
            setOf(
                "ClickableViewAccessibility",
                "ContentDescription",
                "KeyboardInaccessibleWidget",
                "LabelFor",
                "AllowBackup",
                "ExportedContentProvider",
                "ExportedPreferenceActivity",
                "ExportedReceiver",
                "ExportedService",
                "HardcodedDebugMode",
                "SetJavaScriptEnabled",
                "TrustAllX509TrustManager",
                "UnprotectedSMSBroadcastReceiver",
                "UnsafeProtectedBroadcastReceiver",
                "WorldReadableFiles",
                "WorldWriteableFiles",
            )
        // Dependabot moves versions; a new upstream release must not fail unrelated PRs.
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable", "OldTargetApi")
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        allWarningsAsErrors = true
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.androidx.compose.ui.test.junit4.accessibility)
    testImplementation(libs.androidx.test.junit)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}

roborazzi {
    outputDir.set(file("src/test/screenshots"))
}

tasks.named("check") {
    dependsOn("verifyRoborazziDebug", "assembleRelease")
}
