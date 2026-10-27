# TriClub Challenge

A virtual team race along the **Finding Santa** GPX route (Hyde Park, London → Lapland, 3,539 km).
Team totals are read from a public Google Sheet. Each week's totals are saved, and
**Run-Total + Cycle-Total + Swim-Total + Strength-Total** summed over every week is how far a team
has travelled along the route.

- **Map**: the route, with each team shown at its current position. Every team gets its own colour and shape.
- **Leaderboard**: rank, km covered, % complete, gap to the leader.
- **Team pane**: position, distance, km to go, totals by discipline, week-by-week table, previous team names.
- **Weekly pane**: every team's combined total for each week.
- **Disciplines pane**: stacked bars showing how much each discipline contributed for each team.

## How it works

- The server downloads the sheet as CSV every `REFRESH_MINUTES` (default 15), on startup, and when someone clicks **Refresh**.
- Columns are found by header name, not position: a `Team` column plus columns containing `Run`, `Cycle`/`Bike`,
  `Swim` and `Strength` (a header containing "Total" wins, e.g. `Run-Total`). The header row can sit below title rows.
- **Weeks**: if the sheet has a `Week` column, its values are used. Otherwise the sheet is treated as showing
  *this week's* totals, and they are saved under the current week (ISO week, or `Week 1, 2, …` when `CHALLENGE_START`
  is set). Re-reading during the same week overwrites that week's figures, and a new week starts a new entry.
- **Team names change**: teams are recognised by their row position in the sheet, so a renamed team keeps its
  history, icon and place, and the new name shows straight away (old names are listed in the Team pane).
  If you add a `Team ID` column the app uses that instead, which also survives teams being reordered.
  Set `TEAM_KEY=name` to recognise teams by name instead.
- **Icons**: team *n* gets shape `n mod 9` and colour `n mod 10`, so the first 9 teams differ in both shape and
  colour, and the first 90 teams all have different shape/colour combinations.
- Data is stored in `store.json` in `DATA_DIR`. On Azure this defaults to `/home/data`, which persists across restarts and redeployments.

## Run locally

```bash
npm install
npm start            # http://localhost:3000
npm test
```

## Configuration (environment variables / Azure App Settings)

| Setting | Default | Purpose |
|---|---|---|
| `SHEET_ID` | `1j1f2LI1zluWNUFeYprODvV0g6swACpYW1lss1ddDHf8` | Google Sheet ID |
| `SHEET_GID` | `0` | Tab ID (the `gid=` number in the sheet URL) |
| `SHEET_CSV_URL` | – | Use any CSV URL instead of the sheet |
| `REFRESH_MINUTES` | `15` | How often to re-read the sheet |
| `TOTALS_MODE` | `weekly` | `weekly` = sheet shows this week's totals and they're summed; `cumulative` = sheet already shows race-to-date totals |
| `CHALLENGE_START` | – | `YYYY-MM-DD`; labels weeks `Week 1`, `Week 2`, … |
| `TEAM_KEY` | `slot` | `slot` (row position) or `name` |
| `SCALE_RUN`, `SCALE_CYCLE`, `SCALE_SWIM`, `SCALE_STRENGTH` | `1` | Multiply each total before it counts as km (e.g. if Swim is in metres use `0.001`, or weight a discipline) |
| `COL_TEAM`, `COL_TEAM_ID`, `COL_WEEK`, `COL_RUN`, `COL_CYCLE`, `COL_SWIM`, `COL_STRENGTH` | auto | Exact header names, if auto-detection picks the wrong column |
| `ADMIN_KEY` | – | If set, the Refresh button asks for this key |
| `DATA_DIR` | `./data` (`/home/data` on Azure) | Where `store.json` is kept |

The sheet must be shared as **Anyone with the link → Viewer**.

## Deploy to Azure App Service

One-time setup with the Azure CLI:

```bash
RG=triclub-rg
APP=triclub-challenge-$RANDOM     # must be globally unique
az group create -n $RG -l uksouth
az appservice plan create -g $RG -n triclub-plan --is-linux --sku B1
az webapp create -g $RG -p triclub-plan -n $APP --runtime "NODE:22-lts"
az webapp config set -g $RG -n $APP --always-on true --startup-file "npm start"
az webapp config appsettings set -g $RG -n $APP --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true DATA_DIR=/home/data REFRESH_MINUTES=15
```

**Always On** (B1 tier or higher) keeps the app running so it records weekly totals even when nobody is viewing it.
On the Free tier the app sleeps, and a week is only saved if someone opens the site during that week.

Then deploy either way:

- **GitHub Actions** (`.github/workflows/azure-webapp.yml`, runs on every push to `main`):
  in the repo settings add the secret `AZURE_WEBAPP_PUBLISH_PROFILE`
  (`az webapp deployment list-publishing-profiles -g $RG -n $APP --xml`) and the variable `AZURE_WEBAPP_NAME=$APP`.
- **Manually**: `az webapp up -g $RG -n $APP --runtime "NODE:22-lts"` from the repo folder.

## Changing the route

Replace `route/finding-santa.gpx` and run `npm run build:route` (or `node scripts/build-route.js my.gpx`)
to regenerate `route/route.json`.
