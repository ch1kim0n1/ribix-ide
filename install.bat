@echo off
setlocal enabledelayedexpansion

set "REPO=ch1kim0n1/ribix-ide"
set "ASSET_NAME=RibixIDE-win32-x64.zip"
set "INSTALL_ROOT=%LOCALAPPDATA%\RibixIDE"
set "APP_ROOT=%INSTALL_ROOT%\app"
set "ARCHIVE_PATH=%TEMP%\%ASSET_NAME%"
set "RELEASE_JSON=%TEMP%\ribix-ide-release.json"
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Ribix IDE.lnk"
set "APP_DIR=%APP_ROOT%\VSCode-win32-x64"
set "APP_EXE=%APP_DIR%\Ribix IDE.exe"
set "TOTAL_STEPS=5"
set "CURRENT_STEP=0"

where powershell >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo PowerShell is required to install Ribix IDE.
  exit /b 1
)

echo.
echo ==================================
echo   Ribix IDE Installer
echo   Platform: Windows x64
echo ==================================

call :step_start "Fetching release metadata"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$headers = @{ Accept = 'application/vnd.github+json' };" ^
  "Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -OutFile '%RELEASE_JSON%'"
if %ERRORLEVEL% NEQ 0 (
  call :step_fail
  exit /b 1
)
call :step_done

for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$assetName = '%ASSET_NAME%';" ^
  "$release = Get-Content '%RELEASE_JSON%' | ConvertFrom-Json;" ^
  "$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1;" ^
  "if (-not $asset) { throw 'Asset not found in latest release.' };" ^
  "$asset.browser_download_url"`) do (
  set "DOWNLOAD_URL=%%i"
)

if not defined DOWNLOAD_URL (
  call :step_fail
  echo Failed to resolve the download URL for %ASSET_NAME%.
  exit /b 1
)

call :step_start "Downloading %ASSET_NAME%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -UseBasicParsing -Uri '%DOWNLOAD_URL%' -OutFile '%ARCHIVE_PATH%'"
if %ERRORLEVEL% NEQ 0 (
  call :step_fail
  exit /b 1
)
call :step_done

if exist "%APP_ROOT%" rmdir /s /q "%APP_ROOT%"
mkdir "%APP_ROOT%"

call :step_start "Extracting build"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Expand-Archive -Force -Path '%ARCHIVE_PATH%' -DestinationPath '%APP_ROOT%'"
if %ERRORLEVEL% NEQ 0 (
  call :step_fail
  exit /b 1
)
call :step_done

call :step_start "Verifying installation"
if not exist "%APP_EXE%" (
  call :step_fail
  echo Verification failed: "Ribix IDE.exe" not found at expected location
  echo Expected: %APP_EXE%
  exit /b 1
)
call :step_done

call :step_start "Creating desktop shortcut"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$shortcut = $ws.CreateShortcut('%SHORTCUT_PATH%');" ^
  "$shortcut.TargetPath = '%APP_EXE%';" ^
  "$shortcut.WorkingDirectory = '%APP_DIR%';" ^
  "$shortcut.Save()"
if %ERRORLEVEL% NEQ 0 (
  call :step_fail
  exit /b 1
)
call :step_done

echo.
echo ==================================
echo   Installation Complete!
echo ==================================
echo.
echo   Installed to: %APP_DIR%
echo   Executable:   %APP_EXE%
echo   Shortcut:     %SHORTCUT_PATH%
echo.
echo   Double-click the desktop shortcut to start Ribix IDE.
echo   On first launch, the onboarding wizard will guide you through setup.
echo.
exit /b 0

:step_start
set /a CURRENT_STEP+=1
echo.
echo [%CURRENT_STEP%/%TOTAL_STEPS%] %~1 ...
set "STEP_START=%TIME%"
goto :eof

:step_done
echo   done
goto :eof

:step_fail
echo   FAILED
goto :eof
