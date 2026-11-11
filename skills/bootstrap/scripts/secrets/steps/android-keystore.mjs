import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeThenSet } from "../order.mjs";

const ALIAS = "upload";
const NAMES = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];

export function dnValue(text) {
  return text
    .replace(/[,+"\\<>;=]/g, char => `\\${char}`)
    .replace(/^[# ]/, char => `\\${char}`)
    .replace(/ $/, "\\ ");
}

async function generateKeystore(ctx, deps, password) {
  const dir = mkdtempSync(join(tmpdir(), "keystore-"));
  try {
    chmodSync(dir, 0o700);
    const file = join(dir, `${ctx.slug}-upload.jks`);
    const result = await deps.exec(
      "keytool",
      [
        "-genkeypair", "-v",
        "-keystore", file,
        "-alias", ALIAS,
        "-keyalg", "RSA",
        "-keysize", "4096",
        "-validity", "10000",
        "-dname", `CN=${dnValue(ctx.name)}`,
        "-storepass:env", "KS_PASS",
        "-keypass:env", "KEY_PASS",
        "-storetype", "PKCS12",
      ],
      { env: { KS_PASS: password, KEY_PASS: password } },
    );
    if (result.status !== 0) {
      throw new Error(`keytool failed (exit ${result.status}): ${result.stderr.replaceAll(password, "[password]").trim()}`);
    }
    chmodSync(file, 0o600);
    return readFileSync(file).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run(ctx, deps, { vault, rotate }) {
  if (rotate) {
    deps.log("WARNING: a new upload key means existing installs can't update unless the old key is kept. Android only installs an update signed with the key of the installed app.");
    const answer = await deps.prompt("Type rotate to replace the upload key: ", { hidden: false });
    if (answer.trim() !== "rotate") throw new Error("Not confirmed: nothing was created");
  }
  const password = randomBytes(32).toString("base64url");
  const keystore = await generateKeystore(ctx, deps, password);
  await storeThenSet(deps, vault, ctx, {
    title: "upload keystore",
    fields: [
      { name: "keystore password", value: password, hidden: true },
      { name: "key alias", value: ALIAS, hidden: false },
      { name: "keystore (base64)", value: keystore, hidden: true },
    ],
    note: "The Android upload keystore. The key password is the same as the keystore password. Keep an offline backup of the keystore: if it's lost, existing installs can't update.",
    secrets: [
      { name: "ANDROID_KEYSTORE_BASE64", env: "release", value: keystore },
      { name: "ANDROID_KEYSTORE_PASSWORD", env: "release", value: password },
      { name: "ANDROID_KEY_ALIAS", env: "release", value: ALIAS },
      { name: "ANDROID_KEY_PASSWORD", env: "release", value: password },
    ],
    rotate,
  });
  deps.log("The upload keystore is stored in Pass and its four secrets are set. Make an offline backup of the keystore from the Pass item: if it's lost, existing installs can't update.");
}

export default {
  name: "android-keystore",
  tools: ["keytool"],
  secrets: () => NAMES.map(name => ({ name, env: "release" })),
  run,
};
