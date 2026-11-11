# Threat model

What claude-project-bootstrap protects, from whom, and how. Update it in the same PR as any
change that adds or moves a trust boundary ([coding standards](coding-standards.md#security)).

## The system

Describe the components, where each runs, and how data flows between them.

## Trust boundaries

| Boundary | Between | What crosses it | Controls |
|---|---|---|---|
| Release job → GitHub API | `release.yml` and the release GitHub App | Short-lived App token (Contents and Workflows: read and write) to push release tags and create releases | Token minted only in the release job and scoped to this repository; App installed on this repository only; private key held as a repository secret |
| Secrets script → browser callback | `secrets.mjs release-app` and GitHub's App manifest redirect | A one-time manifest code, exchanged for the release App's private key | Listens on `127.0.0.1` only, on a random port; a random `state` is checked; the first valid callback closes the server; times out after an hour |
| Secrets script → password manager CLI | `secrets.mjs` and `pass-cli` | Every credential the script makes or collects | Values go on stdin only, never as arguments or logged; the script never calls `pass-cli item update`, which takes values as arguments |
| Secrets script → Cloudflare API | `secrets.mjs cloudflare-tokens` and `cloudflare-r2`, and a bootstrap token the user creates | A token that can create any account token | The user creates it with only Account API Tokens Write, expiring the same day; it's read from a hidden prompt and deletes itself in every outcome; each token it creates is read back and checked against the requested policies |

## Assets

| Asset | Why it matters |
|---|---|
| Release App private key | Anyone holding it can mint tokens that push tags and, through Workflows, change workflow files |
| Project credentials in the password manager | The source for rebuilds and rotation: the release App key, the board token, the Android upload keystore, the Cloudflare tokens and the R2 credentials |
| Cloudflare bootstrap token | While it exists, it can create a token with any permission on the account |

## Actors

| Actor | Capability | Motivation |
|---|---|---|
| Anonymous internet user | Any public request | Abuse, data access |
| Signed-in user | Their own account | Access to others' data |
| Compromised dependency | Code execution at install or runtime | Credential theft |
| Maintainer account takeover | Repository and platform access | Anything |

## Threats (STRIDE)

| Threat | Category | Mitigation | Status |
|---|---|---|---|
| A local process answers the manifest callback first, to make the script store a key it chose | Spoofing | The callback must carry the random `state` the script generated; the code is exchanged with GitHub, which only returns the App GitHub created | Mitigated |
| | Tampering | | |
| | Repudiation | | |
| A secret read from the process list, a shell history or a log | Information disclosure | Secrets go to `gh` and `pass-cli` on stdin only, and to `keytool` through its own environment; tests check every external call's arguments and every log line | Mitigated |
| Any process signed in as the user, including another Claude session, reads the vault through `pass-cli` | Information disclosure | `pass-cli item view --field` returns hidden values to any process running as the user once it's signed in. Sign out of `pass-cli` when not bootstrapping, and keep each project's credentials in its own folder | Accepted |
| | Denial of service | | |
| A leaked Cloudflare bootstrap token used to mint broad tokens | Elevation of privilege | Its only permission is Account API Tokens Write; it expires the same day; the script deletes it in every outcome and tells the user to revoke it in the dashboard if the delete fails | Mitigated |
| Leaked release token or App key used to alter workflow files | Elevation of privilege | The Workflows permission is needed because GitHub refuses a tag whose commit's workflow files differ from the default branch's. Tokens last one hour and are minted only in the release job; the key is a repository secret; the App is installed on this repository only | Accepted |

## Known gaps

None recorded yet.
