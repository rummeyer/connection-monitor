<p align="center">
  <img src="web/icon.png" alt="" width="128">
</p>

<h1 align="center">Connection Monitor</h1>

<p align="center">
  How fast the router, the internet and anything else on the network answer, and how often they do not —
  <b>Smokeping</b>, on a dashboard in the look of Appliance Monitor's and Synology Monitor's, with Smokeping's history taken over.
</p>

## What it does

Every minute it sends each target 20 pings with [fping](https://fping.org), spread over the minute, as Smokeping's FPing probe does. The dashboard, on port 8584, shows:

- **A tile per target**: the median round-trip time of the last round, *Good*, the share of pings lost, or *No answer*, and the last hour beside it.
- **A chart per target** over 3 hours, 30 hours, 10 days or a year, as Smokeping draws it: the line the median, coloured by loss — green none, blue up to 5 %, orange up to 20 %, red more, dark red no answer at all — and the shade around it the spread of the pings, the fastest and slowest tenth faintest. Pointing at the chart says the time, the median, where most pings were, and the loss.

It has the three looks of the other dashboards — Home, light and dark — switched by the button in its header, and needs no login: it only reads.

## Smokeping's history

`npm run import` reads Smokeping's targets from its Targets file and each one's RRD — five minutes for the last three and a half days, hours for half a year, twelve hours for a year — through Perl's RRDs module, which Smokeping itself uses. Without a `config.json` it writes one with Smokeping's targets, so that the measuring goes on where Smokeping left off. The charts take the finest there is for each stretch: this app's minutes where it has them, Smokeping's five minutes, hours or half days before that.

```sh
npm run import -- --targets /etc/smokeping/config.d/Targets --data /var/lib/smokeping
```

Run again, it replaces what it took before and leaves what was measured here since.

## Keeping it

Everything is in one SQLite file, `data/connection-monitor.db`, built into Node — no packages to install. Each round is kept as it was for 30 days, then folded into its hour; hours are kept for two years. Three targets take a few tens of megabytes.

## Settings

`config.json` beside `package.json`; see `config.example.json`. Every setting has a default.

| Setting | Default | |
|---|---|---|
| `targets` | Router and Internet | `name`, `host`, and `icon`: `router`, `internet`, `server` or `device` (guessed if left out) |
| `stepSeconds` | 60 | Seconds between two rounds |
| `pings` | 20 | Pings per target and round |
| `port` | 8584 | The dashboard's port |
| `fping` | `/usr/bin/fping` | |
| `database` | `data/connection-monitor.db` | |
| `rawDays` | 30 | Days a round is kept before it is folded into its hour |
| `keepDays` | 730 | Days an hour is kept |

## Running it

Node 22.18 or later, which runs the TypeScript as it is, and fping.

```sh
npm start
```

To keep it running, `connection-monitor.service` is a systemd unit; the comment at its top says how to install it.

## Licence

MIT
