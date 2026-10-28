# Tri Before Xmas

London Frontrunners' Christmas challenge: a virtual team race along the **Finding Santa** GPX route (Hyde Park, London → Lapland, 3,539 km).
Team figures are read from a public Google Sheet. A team's distance along the route is

**Run × 4 + Virtual cycle × 0.8 + Outdoor cycle + Swim × 26 + Strength sessions × 25 + Charms − Hexes**

worked out from the sheet's challenge **total** columns, the same formula as its `Challenge Total (Calulated)` column.
Each week's figures (from the **weekly** columns) are saved too, so the app shows a week-by-week history.

- **Map**: the route, with each team shown at its current position. A team with a picture on the sheet's `Images` tab
  shows that picture; every other team gets its own Christmas emoji. Each team also has its own ring colour.
- **Leaderboard**: rank, km covered, % complete, gap to the leader.
- **Team pane**: position, distance, km to go, this week's km, totals by discipline (with the raw sheet value × multiplier),
  week-by-week table, previous team names, and whether the totals match the sheet's calculated columns.
- **Weekly pane**: every team's combined total for each week.
- **Disciplines pane**: stacked bars showing how much each discipline contributed for each team.
- **Message banner**: the text in cell A2 of the sheet's `Message` tab (under a `Message` header in A1) scrolls right to
  left in a candy-cane banner under the header. It's re-read with every refresh; when A2 is empty there's no banner.

## How it works

- The server downloads the sheet as CSV every `REFRESH_MINUTES` (default 15), on startup, and when someone clicks **Refresh**.
- **Columns** are found by header name, not position, on the `Data` tab. It has a `Team Name` column and, for each of
  Run, Virtual cycle, Outdoor cycle, Swim, Strength, Charm and Hex, a total column (`Run-total`, `Virtual-Cycle Total`,
  `Outdoor-Cycle-Total`, …) and a weekly column (`Run-week`, `Virtual-Cycle-week`, `Outdoor Cycle-week`,
  `swim-week`, …). Strength is a number of sessions. Charms are km added and hexes are km taken off (written as `50` or
  `-50`, either way). A team can't be pushed back past the start. The header row can sit below title rows.
- **Weeks** run Sunday to Saturday (UK time). The sheet zeroes its weekly columns on Sunday; until it has, Sunday's
  figures still count for the week just finished; the app tells the reset has happened when the figures drop.
  Anything added to last week after the app's final read of it (say at 09:50, just before a 10:00 reset) is caught up
  on the first read of the new week from the change in the total columns. Re-reading during a week updates that week's figures.
  Weeks are shown by their dates, e.g. `22–28 Nov`, or `Week 4 · 22–28 Nov` when `CHALLENGE_START` is set
  (weeks before the start date are then hidden).
- **Checks**: on every refresh the app compares its own sums with the sheet's `Weekly Total (Calulated)` and
  `Challenge Total (Calulated)` columns (empty cells are skipped). Any team that's out by more than 0.5 km gets a ⚠️ on
  the leaderboard, a warning banner and a note in its Team pane, and the server log lists the mismatch.
- **Team names change**: teams are recognised by their row position in the sheet, so a renamed team keeps its
  history, icon and place, and the new name shows straight away (old names are listed in the Team pane).
  If you add a `Team ID` column the app uses that instead, which also survives teams being reordered.
  Set `TEAM_KEY=name` to recognise teams by name instead.
- **Team pictures**: on the `Images` tab, each team's name is a header in row 1 with a picture placed under it. CSV
  exports leave pictures out, so the app downloads the workbook as `.xlsx` (every `IMAGES_REFRESH_MINUTES`, at startup and
  on **Refresh**), finds each picture's cell, and pairs it with the header above it. Pictures are matched to teams by
  name, so rename a team on both tabs. They're shrunk to 128×128 for the markers.
- **Icons**: teams without a picture get Christmas picture `n mod 11` (tree, snowman, reindeer, present, bell, star, stocking, cookie,
  penguin, elf, snowflake) in a ring of colour `n mod 10`, so the first 10 teams differ in both picture and colour, and
  the first 110 teams all have different combinations.
- Data is stored in `store.json` in `DATA_DIR`. On Azure this defaults to `/home/data`, which persists across restarts and redeployments.

## Hidden prizes

Faint ❄ snowflakes are hidden on the map at **the North Pole** (as far north as the map goes, about 84.5°N),
**Hyde Park in Sydney** (a twist on the London start), **Mount Teide in Tenerife** and **Girona**. They're small
blue snowflakes that only appear once you zoom in close (zoom level 6 by default; the page opens at about 4 on a
desktop and 3 on a phone), so finding them means zooming in on the right part of the map. The **first** person to click each one gets that spot's
prize code, worth 50 km (Girona: 100 km). The finder chooses how to use it: as a **charm**, adding the km to their own
team, or as a **hex**, taking the km off another team. Anyone after that is told someone got there first, and the finder sees their code
again if they click again in the same browser. They send the code and their choice to the organiser, who adds the km to
the Charm columns of their team, or to the Hex columns of the team they picked.

Codes are never in the page; only the server knows them. Set each spot's code in the Azure environment variables:
`NORTH_POLE_CODE`, `SYDNEY_CODE`, `TENERIFE_CODE`, `GIRONA_CODE`. Without one, a random code (e.g. `TEIDE-Y6JT58`) is
made, and the app's log lists every spot's code at startup and records when each is found. Setting a new code for a spot
hides a fresh prize there.

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
| `REFRESH_MINUTES` | `15` | How often to re-read the sheet (`0` = never; just show what's saved) |
| `CHALLENGE_START` | – | `YYYY-MM-DD`; labels weeks `Week 1`, `Week 2`, … and hides weeks before it |
| `TIME_ZONE` | `Europe/London` | Time zone for the Sunday-to-Saturday weeks |
| `VALIDATION_TOLERANCE` | `0.5` | Largest km difference from the sheet's calculated totals still counted as a match |
| `TEAM_KEY` | `slot` | `slot` (row position) or `name` |
| `SCALE_RUN`, `SCALE_VIRTUAL_CYCLE`, `SCALE_OUTDOOR_CYCLE`, `SCALE_SWIM`, `SCALE_STRENGTH` | `4`, `0.8`, `1`, `26`, `25` | km per unit of each sheet value |
| `DATA_SHEET` | `Data` | Tab with the team figures, used if the usual download doesn't find them |
| `COL_TEAM`, `COL_TEAM_ID`, `COL_RUN_WEEKLY`, `COL_RUN_TOTAL` (and the same for `CYCLE`, `SWIM`, `STRENGTH`, `CHARM`, `HEX`), `COL_WEEKLY_CALCULATED`, `COL_CHALLENGE_CALCULATED` | auto | Exact header names, if auto-detection picks the wrong column |
| `MESSAGE_SHEET` | `Message`, then `Sheet2`, `Sheet 2` | Tab holding the banner message (`Message` in A1, the text in A2) |
| `MESSAGE_CSV_URL` | – | Use any CSV URL for the banner message instead |
| `IMAGES_SHEET` | `Images` | Tab holding the team pictures |
| `IMAGES_REFRESH_MINUTES` | `60` | How often to re-read the team pictures |
| `IMAGES_XLSX_URL` | – | Use any `.xlsx` URL for the team pictures instead |
| `NORTH_POLE_CODE`, `SYDNEY_CODE`, `TENERIFE_CODE`, `GIRONA_CODE` | random, shown in the log | Each hidden prize's code; a new value starts a new hunt there |
| `PRIZE_KM` | `50` | km each hidden prize is worth (shown to the finder), apart from Girona |
| `NORTH_POLE_KM`, `SYDNEY_KM`, `TENERIFE_KM`, `GIRONA_KM` | `50`, `50`, `50`, `100` | km for one spot's prize |
| `NORTH_POLE_ENABLED`, `SYDNEY_ENABLED`, `TENERIFE_ENABLED`, `GIRONA_ENABLED` | `true` | `false` hides that spot's snowflake and stops it being claimed |
| `PRIZE_ZOOM` | `6` | How far you must zoom in before the snowflakes appear (higher = harder) |
| `NORTH_POLE_ZOOM`, `SYDNEY_ZOOM`, `TENERIFE_ZOOM`, `GIRONA_ZOOM` | `PRIZE_ZOOM` | The same, for one spot |
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

**Always On** (B1 tier or higher) keeps the app running so it records each week's figures even when nobody is viewing it.
The race distance comes from the sheet's total columns, so it's always right; only the week-by-week history needs the app awake.

Then deploy either way:

- **GitHub Actions** (`.github/workflows/azure-webapp.yml`, runs on every push to `main`):
  in the repo settings add the secret `AZURE_WEBAPP_PUBLISH_PROFILE`
  (`az webapp deployment list-publishing-profiles -g $RG -n $APP --xml`) and the variable `AZURE_WEBAPP_NAME=$APP`.
- **Manually**: `az webapp up -g $RG -n $APP --runtime "NODE:22-lts"` from the repo folder.

## Simulating the challenge

`npm run simulate -- [outDir] [--seed=N] [--refresh=15]` plays the spreadsheet forward from
`test/fixtures/data-tab-2026-11-26.csv` to Christmas Eve, running the app's real code against it. Teams log
activities, charms and hexes are handed out, placeholder teams are renamed, late Saturday entries arrive on Sunday
morning and the `-week` columns are zeroed at 10:00 every Sunday. The app reads the sheet every 15 minutes. It then
compares every saved week with the sheet's `Weekly Total (Calulated)` and every team's total with
`Challenge Total (Calulated)`, and writes `report.md` (with the full activity log) and `store.json` to `outDir`.
It exits non-zero if anything doesn't match.

To look at the simulated race in the browser: `DATA_DIR=outDir REFRESH_MINUTES=0 npm start`.

## Changing the route

Replace `route/finding-santa.gpx` and run `npm run build:route` (or `node scripts/build-route.js my.gpx`)
to regenerate `route/route.json`.
