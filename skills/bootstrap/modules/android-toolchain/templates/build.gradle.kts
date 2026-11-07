import io.gitlab.arturbosch.detekt.getSupportedKotlinVersion

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.roborazzi) apply false
    alias(libs.plugins.spotless)
    alias(libs.plugins.detekt)
}

val ktlintRules =
    mapOf(
        "ktlint_code_style" to "ktlint_official",
        "ktlint_function_naming_ignore_when_annotated_with" to "Composable",
    )

spotless {
    kotlin {
        target("**/*.kt")
        targetExclude("**/build/**")
        ktlint(libs.versions.ktlint.get()).editorConfigOverride(ktlintRules)
    }
    kotlinGradle {
        target("**/*.gradle.kts")
        targetExclude("**/build/**")
        ktlint(libs.versions.ktlint.get()).editorConfigOverride(ktlintRules)
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom("config/detekt/detekt.yml")
    source.setFrom(fileTree(".") { include("*/src/**/*.kt") })
}

// detekt 1.23 embeds its own Kotlin compiler, so keep the Kotlin plugin from upgrading it.
configurations.matching { it.name == "detekt" }.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin") {
            useVersion(getSupportedKotlinVersion())
        }
    }
}

tasks.named("check") {
    dependsOn("spotlessCheck", "detekt")
}
