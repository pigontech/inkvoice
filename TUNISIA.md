# Inkvoice Tunisia

Fork of https://github.com/pigontech/inkvoice with TND (Tunisian Dinar) support.
Select TND in the existing currency selector; monetary amounts retain three
fractional digits (millimes). Company defaults and historical records are not
changed automatically. Exchange rates can be entered manually.

Online payment gateways and structured accounting exports are disabled
for TND because those integrations currently assume two decimal places. Standard
invoice PDFs, ordinary CSV exports, and manually recorded payments support TND.
This fork does not implement Tunisian statutory reporting or tax rules.

## Updates and deployment

`Tunisia sync and deploy` checks upstream main daily at 04:23 UTC and can also be
run manually. It merges without rebasing, runs lint, type checks, all tests,
the frontend build and Docker build, and only then pushes the tested candidate.
Conflicts or failures stop the run; resolve them manually and rerun. No force pushes.
GitHub may disable scheduled workflows after 60 days of repository inactivity;
re-enable this workflow if GitHub sends that notice.

Successful runs advance `production` to the tested commit. Coolify follows only
that branch through a signed GitHub push webhook; pushes to `main` cannot deploy
until checks pass. This preserves Coolify's local-network API IP restriction and
requires no Coolify API token. The workflow waits for `/health` to return status
`ok` and the tested `commit` (Coolify's existing `SOURCE_COMMIT` environment value).
Repository variable `COOLIFY_DEPLOY_ENABLED=true` enables production promotion.
Failed updates/deployments are visible in GitHub Actions. If the production branch
already contains a commit whose deployment failed, retry it from Coolify.

Production keeps its existing domain, environment and `/app/data` volume.
Before initial cutover, take a SQLite-consistent snapshot and a volume backup,
verify an isolated restored copy, and record the previous image/commit. For
rollback, pin that previous commit and redeploy. If an upstream migration changed
the schema incompatibly, stop the application and restore the matching backup
before starting the previous image. Never restore over a running SQLite database.
