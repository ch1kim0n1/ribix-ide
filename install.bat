@echo off
setlocal

set "REPO=ch1kim0n1/ribix-ide"
set "ASSET_NAME=RibixIDE-win32-x64.zip"
set "INSTALL_ROOT=%LOCALAPPDATA%\RibixIDE"
set "APP_ROOT=%INSTALL_ROOT%\app"
set "ARCHIVE_PATH=%TEMP%\%ASSET_NAME%"
set "RELEASE_JSON=%TEMP%\ribix-ide-release.json"
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Ribix IDE.lnk"

where powershell >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo PowerShell is required to install Ribix IDE.
  exit /b 1
)

echo Fetching latest release metadata for %REPO%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$headers = @{ Accept = 'application/vnd.github+json' };" ^
  "Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -OutFile '%RELEASE_JSON%'"
if %ERRORLEVEL% NEQ 0 exit /b 1

for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$assetName = '%ASSET_NAME%';" ^
  "$release = Get-Content '%RELEASE_JSON%' | ConvertFrom-Json;" ^
  "$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1;" ^
  "if (-not $asset) { throw 'Asset not found in latest release.' };" ^
  "$asset.browser_download_url"`) do (
  set "DOWNLOAD_URL=%%i"
)

if not defined DOWNLOAD_URL (
  echo Failed to resolve the download URL for %ASSET_NAME%.
  exit /b 1
)

echo Downloading %ASSET_NAME%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -UseBasicParsing -Uri '%DOWNLOAD_URL%' -OutFile '%ARCHIVE_PATH%'"
if %ERRORLEVEL% NEQ 0 exit /b 1

if exist "%APP_ROOT%" rmdir /s /q "%APP_ROOT%"
mkdir "%APP_ROOT%"

echo Extracting build...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Expand-Archive -Force -Path '%ARCHIVE_PATH%' -DestinationPath '%APP_ROOT%'"
if %ERRORLEVEL% NEQ 0 exit /b 1

echo Creating desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$shortcut = $ws.CreateShortcut('%SHORTCUT_PATH%');" ^
  "$shortcut.TargetPath = '%APP_ROOT%\VSCode-win32-x64\Code.exe';" ^
  "$shortcut.WorkingDirectory = '%APP_ROOT%\VSCode-win32-x64';" ^
  "$shortcut.Save()"
if %ERRORLEVEL% NEQ 0 exit /b 1

echo.
echo Installed to %APP_ROOT%\VSCode-win32-x64
echo Desktop shortcut created at %SHORTCUT_PATH%
echo Installation complete.
