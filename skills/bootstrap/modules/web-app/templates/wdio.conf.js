import { spawn } from "node:child_process";

const BASE_URL = "http://localhost:4173";
let server;

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${url} didn't answer within ${timeoutMs / 1000}s`);
}

const BROWSERS = {
  chrome: { browserName: "chrome", browserVersion: "stable", "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox"] } },
  firefox: { browserName: "firefox", browserVersion: "stable", "moz:firefoxOptions": { args: ["-headless"] } },
  safari: { browserName: "safari" },
};

const selected = (process.env.E2E_BROWSERS ?? "chrome,firefox").split(",").map(name => name.trim());

export const config = {
  runner: "local",
  specs: ["./e2e/**/*.spec.js"],
  maxInstances: selected.includes("safari") ? 1 : 2,
  capabilities: selected.map(name => {
    if (!BROWSERS[name]) throw new Error(`Unknown browser in E2E_BROWSERS: ${name}`);
    return BROWSERS[name];
  }),
  baseUrl: BASE_URL,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 60000 },
  async onPrepare() {
    server = spawn("pnpm", ["e2e:server"], { stdio: "inherit", detached: true });
    await waitFor(BASE_URL, 120000);
  },
  onComplete() {
    if (server) process.kill(-server.pid);
  },
};
