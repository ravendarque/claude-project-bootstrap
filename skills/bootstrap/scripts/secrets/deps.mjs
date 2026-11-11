import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function exec(cmd, args, { input, env } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: "pipe", ...(env && { env: { ...process.env, ...env } }) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", error => resolve({ status: error.code === "ENOENT" ? 127 : 1, stdout, stderr: `${cmd}: ${error.message}` }));
    child.on("close", status => resolve({ status: status ?? 1, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export function consumeHidden(answer, chunk) {
  for (const char of chunk) {
    if (char === "\r" || char === "\n") return { answer, done: "enter" };
    if (char === "\u0003") return { answer, done: "cancel" };
    if (char === "\u0004") return { answer, done: answer ? "enter" : "cancel" };
    answer = char === "\u007f" || char === "\b" ? answer.slice(0, -1) : answer + char;
  }
  return { answer, done: null };
}

function hiddenPrompt(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("A hidden prompt needs an interactive terminal"));
      return;
    }
    stdout.write(question);
    let answer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = outcome => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      outcome();
    };
    const onData = chunk => {
      const next = consumeHidden(answer, chunk);
      answer = next.answer;
      if (next.done === "enter") finish(() => resolve(answer));
      else if (next.done === "cancel") finish(() => reject(new Error("Cancelled")));
    };
    stdin.on("data", onData);
  });
}

function prompt(question, { hidden = false } = {}) {
  if (hidden) return hiddenPrompt(question);
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function openUrl(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(opener, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

export const realDeps = {
  exec,
  prompt,
  openUrl,
  fetch: (...args) => globalThis.fetch(...args),
  now: () => new Date(),
  log: line => console.log(line),
};
