# First launch and project load verification

Date: 2026-07-26. Related: ch1kim0n1/ribix#350.

## Bug found

Windows `install.bat` verified and shortcut-targeted `VSCode-win32-x64\Code.exe`, but the published `RibixIDE-win32-x64.zip` (v1.0.4) ships `Ribix IDE.exe`. Fresh install always failed at verification.

## Fix

`install.bat` now checks and shortcuts `Ribix IDE.exe`.

## Manual verification (Windows)

| Scenario | Result |
| -------- | ------ |
| Install from release zip after fix | Pass (`Ribix IDE.exe` present) |
| First launch with empty folder | Pass (process stayed up) |
| Open sample repo (README + index.js) | Pass |
| Open larger tree (~200 TS files) | Pass |
| Cold start wait (empty folder, clean user-data-dir) | ~17s to stable process |

Launch used a clean `--user-data-dir` so onboarding runs as a first-time user.
