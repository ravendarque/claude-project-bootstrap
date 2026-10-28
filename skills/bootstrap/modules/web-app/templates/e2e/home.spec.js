import { $, browser, expect } from "@wdio/globals";

describe("home page", () => {
  it("greets", async () => {
    await browser.url("/");
    await expect($("h1")).toHaveText({{greeting_js}});
  });
});
