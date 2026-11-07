package {{application_id}}

import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GreetingScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsTheGreetingAccessibly() {
        composeRule.enableAccessibilityChecks()
        composeRule.setContent { AppTheme { GreetingScreen({{name_kotlin}}) } }

        composeRule.onNodeWithText({{greeting_kotlin}}).assertExists()
        composeRule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun lightTheme() {
        composeRule.setContent { AppTheme(darkTheme = false) { GreetingScreen({{name_kotlin}}) } }
        composeRule.onRoot().captureRoboImage()
    }

    @Test
    fun darkTheme() {
        composeRule.setContent { AppTheme(darkTheme = true) { GreetingScreen({{name_kotlin}}) } }
        composeRule.onRoot().captureRoboImage()
    }

    @Test
    @Config(fontScale = 2f)
    fun largeFontScale() {
        composeRule.setContent { AppTheme { GreetingScreen({{name_kotlin}}) } }
        composeRule.onRoot().captureRoboImage()
    }
}
