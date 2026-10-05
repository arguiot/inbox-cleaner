# Inbox Cleaner

An unattended cleaner for two Gmail accounts, hosted on Cloudflare Workers Free with Workers AI.
Scheduled runs apply the owner's approved **permanent deletion** policy. Snapshot previews and tests never change Gmail.

## Behavior

Clef-flash applies an aggressive relevance policy based on the categories the owner discards. It keeps personal
conversations, new requests, unresolved invoices and concrete problems needing attention. It flags marketing,
newsletters, social digests, meeting recaps, routine receipts/statements, calendar copies and app notifications.
Financial or security topics alone do not guarantee preservation; concrete new problems do. Cold outreach is unwanted.
Ambiguous mail stays. Starred mail, drafts, sent mail, Spam, and Trash are protected.
Before deletion, the message is fetched again, labels/content are compared, and recent sent replies protect the thread.
Deletion uses selected Gmail message IDs through `batchDelete`; it never empties the mailbox's Trash.
Clef must choose unwanted with a score of at least 0.80. This score is a decision threshold,
**not a measured probability of correctness**. There is no target percentage or forced deletion quota.
The October 5 local preview flagged 93 of 107 snapshot emails (87%); this is not a measured accuracy rate.

The worker runs every minute in small batches. It checks inbox mail from the past 30 days plus all unread inbox mail.
Messages outside this scope are not cleaned. State stores IDs, category, and status; it does not store bodies or subjects.
Already processed mail is skipped. The shared daily AI cap is 500 attempts across both accounts; failures retain mail.
Hosting must stay on the Free plan. No paid AI fallback exists. Provider quotas can postpone processing.
Clef-flash uses one typed relevance question, no generated output, and up to 3,000 characters of body text.
The 107-message preview used 172,340 input tokens, approximately 1,410 of the 10,000 free daily AI neurons.
This processes mail after Gmail receives it; it does not reject mail before delivery.

## Local verification

```sh
npm ci --ignore-scripts
npm run check
npm test
npx wrangler deploy --dry-run
```

To classify a connector-exported snapshot without Gmail writes:

```sh
node --env-file=.dev.vars scripts/preview.mjs private/snapshot.json reports/preview.json
```

The snapshot format is an array of `{email,messages}` accounts, with messages in Gmail API format.
Set `CF_ACCOUNT_ID` and `CF_AI_TOKEN` for **the personal Cloudflare account**. Reports remain ignored by Git.
This runs the actual classification code against live Cloudflare AI. Unit tests use synthetic mail and mock providers.

## Gmail authorization

Create a Google OAuth client in a personal Google Cloud project and enable Gmail API. Use a Desktop app client.
Keep the downloaded client JSON under ignored `private/`. Set the consent app to Production; Testing-mode refresh
tokens for restricted Gmail scopes expire after seven days. A personal app need not be offered to outside users.
The Google connector's credentials cannot be transferred into this worker; both Gmail accounts require one-time authorization.

```sh
npm run auth:gmail -- private/google-client.json arguiot@gmail.com
npm run auth:gmail -- private/google-client.json arthur@circleback.ai
```

The helper validates OAuth state, uses PKCE, checks account identity, and writes refresh tokens to ignored
`private/accounts.json` with owner-only permissions. Tokens and mail snapshots never belong in Git or CI artifacts.
The full Gmail scope is required for permanent deletion.

## Personal Cloudflare deployment

Create a D1 database named `inbox-cleaner-state` in the personal account. The deployment token needs personal-account
Workers Scripts Edit, D1 Edit, Workers AI access, account subscriptions read, and User Details Read for identity verification.
Pin `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID` as repository variables. Set `CLOUDFLARE_API_TOKEN` as a
secret in the `personal-cloudflare` GitHub environment. Do not use Circleback credentials or accounts.
The deploy helper verifies the token identifies `arguiot@gmail.com` before any Cloudflare mutation.
First pin the verified personal account ID and Free-plan status in `cloudflare-target.json`. An unverified target refuses deployment.

Set Worker secrets using Wrangler: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_ACCOUNTS_JSON`.
`ADMIN_TOKEN` is optional and is not installed; the public run endpoint is therefore inaccessible.
Secrets are installed directly into Cloudflare; Gmail tokens are not passed through GitHub CI.

Enable the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` after personal account verification.
Pushes to `main` then run checks/tests, apply D1 migrations, and deploy. Pull requests run CI without deployment secrets.
The CI/CD token cannot silently select an account from the machine's global Wrangler session.

`GET /health` exposes only mode/readiness. `POST /run` requires `Authorization: Bearer <ADMIN_TOKEN>` and always previews.
Execution logs contain counts, fixed provider status messages, and source locations; no email bodies or subjects are logged.
To disable scheduled permanent deletion, change `MODE` to `preview` in `wrangler.jsonc`. To enable it, use `delete`
after the actual classifier preview is reviewed and validation is complete. Each deploy retains the checked-in mode.

## Status

Do not confuse a passing unit test/build with a connected live deployment. Cloudflare AI preview, Gmail offline authorization,
the personal-account deployment, and GitHub deployment secrets must all be verified separately.
