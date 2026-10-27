# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-10-27

### Changed

- The chart's ranges: 1 hour, 3, 12 or 24 hours, 7 or 30 days, or a year,
  in place of Smokeping's 3 hours, 30 hours, 10 days and a year; 24 hours
  first. A range in the address, as `#3h`, for a bookmark.

### Fixed

- A gap in the rounds, as while the machine restarts, was filled with
  Smokeping's hourly or twelve-hour averages; a range now takes nothing
  longer than a twelfth of it.

## [1.0.0] — 2026-10-27

The first release.

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

[Unreleased]: https://github.com/rummeyer/connection-monitor/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rummeyer/connection-monitor/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rummeyer/connection-monitor/releases/tag/v1.0.0
