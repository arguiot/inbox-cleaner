# Inbox Cleaner

An unattended cleaner for two Gmail accounts, hosted on Cloudflare Workers Free with Workers AI.
The initial deployment is **preview only**. Local tests and previews never delete, archive, label, or mark mail read.

## Behavior

The classifier keeps human conversations, actionable requests, receipts/invoices, money, travel, calendar changes,
and security messages. It flags marketing, newsletters, social digests, and routine automated summaries.
Ambiguous mail stays. Starred mail, drafts, sent mail, Spam, and Trash are protected.
Before deletion, the message is fetched again, labels/content are compared, and recent sent replies protect the thread.
Deletion uses selected Gmail message IDs through `batchDelete`; it never empties the mailbox's Trash.
Model confidence is a decision threshold, **not a measured probability of correctness**.

The worker runs every minute in small batches. It checks inbox mail from the past 30 days plus all unread inbox mail.
Messages outside this scope are not cleaned. State stores IDs, category, and status; it does not store bodies or subjects.
Already processed mail is skipped. The shared daily AI cap is 500 attempts across both accounts; failures retain mail.
Hosting must stay on the Free plan. No paid AI fallback exists. Provider quotas can postpone processing.
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

Set Worker secrets using Wrangler: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_ACCOUNTS_JSON`, and `ADMIN_TOKEN`.
Secrets are installed directly into Cloudflare; Gmail tokens are not passed through GitHub CI.

Enable the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` after personal account verification.
Pushes to `main` then run checks/tests, apply D1 migrations, and deploy. Pull requests run CI without deployment secrets.
The CI/CD token cannot silently select an account from the machine's global Wrangler session.

`GET /health` exposes only mode/readiness. `POST /run` requires `Authorization: Bearer <ADMIN_TOKEN>` and always previews.
Preview reports are counts only. To enable scheduled permanent deletion, change `MODE` to `delete` in `wrangler.jsonc`
after the actual classifier preview is reviewed and validation is complete. Each deploy retains the checked-in mode.

## Status

Do not confuse a passing unit test/build with a connected live deployment. Cloudflare AI preview, Gmail offline authorization,
the personal-account deployment, and GitHub deployment secrets must all be verified separately.
