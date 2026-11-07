package {{application_id}}.core

import kotlin.test.Test
import kotlin.test.assertEquals

class GreetingTest {
    @Test
    fun greetsByName() {
        assertEquals({{greeting_kotlin}}, greeting({{name_kotlin}}))
    }
}
