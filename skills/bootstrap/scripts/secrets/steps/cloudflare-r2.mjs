import { bucketResource, createVerified, findEarlierItems, oneYearFrom, R2_BUCKET_SCOPE, readOldIds, resolvePermissions, s3Credentials, storeEach, withBootstrapToken } from "../cloudflare.mjs";
import { resolveAccountId } from "../ids.mjs";
import { storeThenSet } from "../order.mjs";

const PAIRS = [
  { title: "R2 state read-write", permission: "Workers R2 Storage Bucket Item Write", id: "TF_STATE_ACCESS_KEY_ID", secret: "TF_STATE_SECRET_ACCESS_KEY", env: "infra" },
  { title: "R2 state read-only", permission: "Workers R2 Storage Bucket Item Read", id: "TF_STATE_READ_ACCESS_KEY_ID", secret: "TF_STATE_READ_SECRET_ACCESS_KEY" },
];

async function run(ctx, deps, options) {
  const { vault, rotate } = options;
  const previous = await findEarlierItems(deps, vault, PAIRS.map(pair => pair.title), rotate);
  const accountId = await resolveAccountId(ctx, deps, options);
  const resource = bucketResource(accountId, `${ctx.slug}-tfstate`);
  const expires = oneYearFrom(deps.now());

  await withBootstrapToken(deps, accountId, async client => {
    const olds = (await readOldIds(vault, previous)).map((old, index) => old && { ...old, name: PAIRS[index].title });
    const specs = [];
    for (const pair of PAIRS) {
      const [{ id }] = await resolvePermissions(client, accountId, [pair.permission], [R2_BUCKET_SCOPE]);
      specs.push({ label: pair.title, name: `${ctx.slug} ${pair.title}`, policies: [{ effect: "allow", resources: { [resource]: "*" }, permission_groups: [{ id }] }] });
    }
    const made = await createVerified(client, deps, accountId, specs);
    await storeEach(client, deps, accountId, made, (token, index) => {
      const pair = PAIRS[index];
      const { accessKeyId, secretAccessKey } = s3Credentials(token);
      const env = pair.env && { env: pair.env };
      return storeThenSet(deps, vault, ctx, {
        title: pair.title,
        fields: [
          { name: "access key id", value: accessKeyId, hidden: false },
          { name: "secret access key", value: secretAccessKey, hidden: true },
          { name: "token id", value: token.id, hidden: false },
          { name: "expires", value: expires, hidden: false },
        ],
        note: `The R2 S3 credentials for the ${ctx.slug}-tfstate bucket, set as the GitHub secrets ${pair.id} and ${pair.secret}${pair.env ? ` in ${pair.env}` : ""}.`,
        secrets: [{ name: pair.id, ...env, value: accessKeyId }, { name: pair.secret, ...env, value: secretAccessKey }],
        rotate,
      });
    }, olds);
  });
  deps.log("The R2 state credentials are stored in Pass and set in GitHub.");
}

export default {
  name: "cloudflare-r2",
  secrets: () => PAIRS.flatMap(pair => [pair.id, pair.secret].map(name => ({ name, ...(pair.env && { env: pair.env }) }))),
  run,
};
