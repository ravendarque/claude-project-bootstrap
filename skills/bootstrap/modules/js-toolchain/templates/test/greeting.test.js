import { expect, test } from "vitest";
import { greeting } from "../src/greeting.js";

test("greets by name", () => {
  expect(greeting({{name_js}})).toBe({{greeting_js}});
});
