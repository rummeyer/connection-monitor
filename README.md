<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/connection-monitor/main/docs/icon.png" alt="" width="120" height="120">
</p>

<h1 align="center">Connection Monitor</h1>

<p align="center">
  How fast your <b>router</b>, the <b>internet</b> and anything else on your network answer — and how often they <b>do not</b>.
  Smokeping, on a dashboard in the look of Apple's Home app, with <b>Smokeping's history taken over</b>.
</p>

<p align="center">
  <a href="https://github.com/rummeyer/connection-monitor/actions/workflows/build.yml"><img src="https://github.com/rummeyer/connection-monitor/actions/workflows/build.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rummeyer/connection-monitor/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="Licence"></a>
  <img src="https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-green" alt="Node 22, 24 or 26">
  <img src="https://img.shields.io/badge/dependencies-none-brightgreen" alt="No dependencies">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/rummeyer"><img src="https://img.shields.io/badge/donate-Buy%20Me%20a%20Coffee-yellow" alt="Buy Me a Coffee"></a>
  <a href="https://paypal.me/rummeyer"><img src="https://img.shields.io/badge/donate-PayPal-00457C" alt="PayPal"></a>
  <a href="https://github.com/sponsors/rummeyer"><img src="https://img.shields.io/badge/sponsor-GitHub-ea4aaa" alt="GitHub Sponsors"></a>
</p>

---

Every minute it sends each target **20 pings** with [fping](https://fping.org), spread over the minute, as Smokeping's FPing probe does, and keeps what came back. A **dashboard** shows each target's latency and loss now, and its chart over **3 hours, 30 hours, 10 days or a year** — drawn as Smokeping draws it: the **median** a line coloured by loss, the **spread of the pings** the smoke around it.

Coming from Smokeping? One command takes over its targets and its **year of history**, and the charts go on seamlessly where Smokeping left off.

No packages to install, no build, no database server: **Node** runs it as it is, **SQLite** comes with Node, and fping does the pinging.

<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/connection-monitor/main/docs/dashboard-home.png" alt="The dashboard in the Home look: tiles for Router (0.76 ms, Good), Internet (15.3 ms, Good) and Diskstation (No answer), and below them 30-hour charts of each, the median a green line in grey smoke, the Diskstation a red line of no answer" width="760">
</p>

## What you see

**A tile per target**: the median round-trip time of the last round, and whether it is *Good*, losing pings, or giving *No answer* at all — with the last hour beside it.

**A chart per target**, over 3 hours, 30 hours, 10 days or a year:

- The **line** is the median, coloured by loss: green none, blue up to 5 %, orange up to 20 %, red more, dark red no answer at all.
- The **smoke** around it is the spread of the pings: the fastest and slowest tenth faintest, the middle fifth darkest. Wide smoke means jitter; a line without smoke, a steady connection.
- **Point at it** for the time, the median, where most pings were, and the loss.

**Three looks**, as Appliance Monitor's and Synology Monitor's dashboards: Home, light and dark, switched by the button in the header. The dashboard needs no login, as it only reads.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rummeyer/connection-monitor/main/docs/dashboard-dark.png">
    <img src="https://raw.githubusercontent.com/rummeyer/connection-monitor/main/docs/dashboard-light.png" alt="The dashboard in the light look, 30 hours: Router around 0.7 ms, Internet around 12 ms with its evening peaks, and the Diskstation not answering" width="380">
  </picture>
  &nbsp;
  <img src="https://raw.githubusercontent.com/rummeyer/connection-monitor/main/docs/dashboard-year.png" alt="A year: the Router steady below a millisecond, the Internet dropping from about 20 to about 12 ms in February, and the Diskstation answering only on the days it was switched on" width="380">
</p>

## Coming from Smokeping

```sh
npm run import
```

Run on the machine Smokeping runs on, it reads Smokeping's targets from `/etc/smokeping/config.d/Targets` and each one's RRD from `/var/lib/smokeping` — five minutes for the last three and a half days, hours for half a year, twelve hours for a year — through Perl's RRDs module, which Smokeping itself uses, so `rrdtool` need not be installed. Other places:

```sh
npm run import -- --targets /path/to/Targets --data /path/to/rrds
```

Without a `config.json` it writes one with Smokeping's targets, so that the measuring goes on where Smokeping left off. For each stretch the charts take the finest there is: this app's minutes where it has them, Smokeping's five minutes, hours or half days before that. Run again — say right after stopping Smokeping, for its last minutes — it replaces what it took before and leaves what was measured here since.

## Installation

You need **Node.js 22.18 or later**, which runs the TypeScript as it is, and **fping** (`sudo apt install fping` on Debian and Raspberry Pi OS). fping must be allowed to ping without root, as it is on Debian.

```sh
git clone https://github.com/rummeyer/connection-monitor.git
cd connection-monitor
cp config.example.json config.json   # or: npm run import, coming from Smokeping
npm start
```

Then open `http://<this machine>:8584/`.

To keep it running, `connection-monitor.service` is a systemd unit — set the user and folder in it, then:

```sh
sudo cp connection-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now connection-monitor
```

## Settings

`config.json` beside `package.json`; see [`config.example.json`](config.example.json). Every setting has a default, so a missing one just takes it.

| Setting | Default | |
|---|---|---|
| `targets` | Router and Internet | Each with a `name`, a `host`, and an `icon`: `router`, `internet`, `server` or `device` — guessed if left out |
| `stepSeconds` | `60` | Seconds between two rounds |
| `pings` | `20` | Pings per target and round, spread over nine tenths of the step |
| `port` | `8584` | The dashboard's port |
| `fping` | `/usr/bin/fping` | |
| `database` | `data/connection-monitor.db` | Relative to the folder, or absolute |
| `rawDays` | `30` | Days each round is kept as measured, before it is folded into its hour |
| `keepDays` | `730` | Days an hour is kept |

## How it keeps the data

Everything is in one SQLite file. Each round — its pings' times and how many were lost — is kept as measured for 30 days, then folded into its hour, which keeps the quantiles of all its pings, so the smoke of a year-old hour is still its own. Three targets take a few tens of megabytes.

The dashboard asks two things, both read only:

| | |
|---|---|
| `GET /api/status` | Every target: its last round, its last hour and its last day |
| `GET /api/series?target=Router&range=30h` | A target's chart, `3h`, `30h`, `10d` or `1y`, as points with the median, loss and the quantiles of the pings |

## Development

```sh
npm test
```

No build step and nothing to install: Node strips the types as it runs the files.

## Licence

[MIT](LICENSE)
