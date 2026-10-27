# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pings every target 20 times a minute with fping, as Smokeping's FPing probe,
  and keeps the rounds in SQLite: 30 days as they were, then by the hour for
  two years.
- A dashboard on port 8584 in the look of Appliance Monitor's and Synology
  Monitor's — Home, light and dark: a tile per target, and a chart per target
  over 3 hours, 30 hours, 10 days or a year, the median coloured by loss and
  the spread of the pings as smoke.
- `npm run import`: Smokeping's targets and its year of history, read from
  its RRDs through Perl's RRDs module.
- A systemd unit.
