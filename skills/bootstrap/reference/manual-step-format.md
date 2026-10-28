# Manual step format

A manual step is something the user does themselves: creating a token,
setting a secret, a console setting with no API. Write each one as:

```
### <module>:<n> <Title>

**Why:** one sentence on what breaks without it.

**Do:**
1. Exact console path or command, one action per line.
2. Values to enter, verbatim. Permissions as an exact list.

**Verify (Claude runs):** `<command>`
**Expected:** what the output must show.
```

Present one step at a time. Wait for the user to say it's done, run the
verification and show the result. If verification fails, say what's
wrong and repeat the step; never mark it done on the user's word alone
when a check exists. A step with no possible check (a console toggle with
no API) says so and takes the user's confirmation.

Every module's manual steps are also written into the generated repo's
docs (setup and disaster recovery), so a rebuild follows the same steps.
