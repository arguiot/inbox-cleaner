# Inbox Cleaner

A self-hosted Gmail cleaner using Cloudflare Workers, Workflows, D1, and Workers AI.
Clef-flash classifies unwanted mail and moves it to **Gmail Trash**. It runs in the cloud without keeping a computer open.
Licensed under [MIT](LICENSE).

The default policy is aggressive: keep personal conversations, specific requests, unresolved invoices, and concrete problems
needing attention; flag marketing, newsletters, cold outreach, digests, meeting recaps, and routine notifications.
Review a preview against your own mail before enabling it. Classification can make mistakes. Model scores are decision
thresholds, not measured probabilities of correctness.

## Behavior

A small batch runs approximately every two minutes, prioritizing all unread inbox messages before read inbox mail from
the past 30 days. Up to three messages per account are processed per batch, with a shared cap of 500 AI attempts per UTC day.
Starred messages, drafts, sent mail, Spam, and Trash are protected. Fresh content/labels are checked before moving a message;
recent sent replies protect the conversation.

Flagged messages go to Trash, where you can restore them for 30 days before Gmail automatically deletes them.
The cleaner never empties Trash and has no permanent-deletion function. Restored messages already recorded by the cleaner
are skipped. Processing happens after Gmail receives mail; this does not reject messages before delivery.

A D1 lease prevents concurrent cleanup. Each workflow processes one bounded batch, sleeps, then starts a fresh successor.
The GitHub watchdog checks its heartbeat hourly and recovers a stale scheduler. No public connection endpoint exists;
the optional authenticated HTTP run endpoint only previews decisions.

## Setup

Use your own Gmail OAuth client and Cloudflare account. New checkouts start in **preview** mode.
Forks do not inherit the original repository's deployment secrets or variables.

### 1. Install and verify

Node.js 22 or later is required.

```sh
npm ci --ignore-scripts
npm run check
npm test
npx wrangler deploy --dry-run
cp cloudflare-target.example.json cloudflare-target.json
```

Fill in your Cloudflare account ID and the email that owns its API token in `cloudflare-target.json`.
Verify Workers Free before setting `freePlanVerified` to `true`. This local file is ignored by Git.
Deployment compares the account and token-owner email, and refuses a paid Workers subscription.

### 2. Connect Gmail

Create a Google Cloud project, enable Gmail API, and create a Desktop OAuth client. Save its downloaded JSON as
`private/google-client.json`. Configure the consent app for personal use and set it to Production; Testing-mode refresh
credentials for Gmail scopes can expire after seven days. Each account requires one-time consent.

```sh
npm run auth:gmail -- private/google-client.json you@example.com
# Optional additional account:
npm run auth:gmail -- private/google-client.json work@example.com
```

The helper uses OAuth state and PKCE, checks account identity, and saves refresh tokens in `private/accounts.json`
with owner-only permissions. New connections request `gmail.modify`; existing full Gmail grants also work.
Keep credentials, snapshots, and reports out of Git. They are ignored by default.

### 3. Configure hosting

Create a D1 database named `inbox-cleaner-state` in the chosen account. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
and `GMAIL_ACCOUNTS_JSON` as Worker secrets directly in Cloudflare. The accounts secret contains `private/accounts.json`.

Create the GitHub environment `personal-cloudflare` and add `CLOUDFLARE_API_TOKEN` as an environment secret.
The token needs Workers Scripts Edit, D1 Edit, Workers AI access, account subscriptions read, and User Details Read.
Gmail credentials belong in Cloudflare, not GitHub Actions.

Set these repository variables:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your selected account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | Your D1 database ID |
| `CLOUDFLARE_EXPECTED_EMAIL` | The email that owns the token |
| `CLOUDFLARE_FREE_PLAN_VERIFIED` | `true`, after verifying Workers Free |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` |
| `CLEANER_MODE` | `preview` initially |

Restrict the deployment environment to the `main` branch. Deployment and watchdog workflows also require `main`;
pull-request CI has no deployment credentials. Push to `main` to apply migrations and deploy.

### 4. Preview, activate, and pause

A private snapshot is an array of `{email,messages}` accounts with messages in Gmail API format.
Copy `.env.example` to ignored `.dev.vars` and fill in `CF_ACCOUNT_ID` and `CF_AI_TOKEN` for your configured account.

```sh
node --env-file=.dev.vars scripts/preview.mjs private/snapshot.json reports/preview.json
```

This sends message text to Cloudflare AI without changing Gmail. Review the ignored report.
The relevance policy is in `src/classifier.mjs`; customize it to fit what you want to keep.
A snapshot preview is not an accuracy evaluation or proof that a live deployment works.

After reviewing a preview, set `CLEANER_MODE=trash` and run the deployment workflow.
The checked-in configuration stays in preview mode so a fresh checkout cannot enable cleanup accidentally.
To pause, set `CLEANER_MODE=preview` and deploy. Deployment updates a D1 control gate, which running workflows
recheck before each move to Trash. Revoking the Google grant also stops access.

## Free-plan limits

Each workflow caps Gmail fetches at 40 to leave room under the Free plan's 50 external-subrequest limit.
Those limits accumulate across the entire workflow, including sleeps. Three steps per two-minute cycle use at most
2,160 steps/day, below the documented 3,000/day Free allowance. The hourly watchdog uses approximately 744 Linux
runner minutes in a 31-day month. Private-repository runner allowances are shared across the GitHub account.
Quotas or failures can defer cleanup; there is no paid AI fallback. Check current
[limits](https://developers.cloudflare.com/workflows/reference/limits/) and
[pricing](https://developers.cloudflare.com/workflows/reference/pricing/) when deploying.

## Privacy

The classifier sends sender, recipient, subject, snippet, and up to 3,000 characters of body to Cloudflare AI.
Mail may contain personal or confidential information. Cloudflare secrets hold OAuth credentials; D1 stores message IDs,
categories, and status rather than bodies or subjects. Logs contain aggregate counts and fixed error messages.
Local previews contain mail text and stay outside the repository. Cloudflare data and encrypted deployment secrets do not
become public when the source repository is public.

The Worker serves app identity and privacy disclosures at `/` and `/privacy` for Google authorization.
Self-hosted operators should review those disclosures for their own deployment. This is not a hosted public email service.
See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
