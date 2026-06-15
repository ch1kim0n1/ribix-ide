@echo off
REM Ribix IDE One-Click Installer for Windows

echo 🚀 Ribix IDE One-Click Installer
echo ==================================

REM Check Node.js
echo 📋 Checking Node.js version...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed
    echo Please install Node.js 20.18.2 from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo Found Node.js version: %NODE_VERSION%

REM Check if Node.js version matches
if not "%NODE_VERSION%"=="v20.18.2" (
    echo ⚠️  Warning: Node.js version v20.18.2 is recommended
    echo Current version: %NODE_VERSION%
    set /p CONTINUE="Continue anyway? (y/n): "
    if /i not "%CONTINUE%"=="y" exit /b 1
)

REM Clone or update repository
echo 📥 Getting Ribix IDE...
if exist "ribix-ide" (
    echo Updating existing installation...
    cd ribix-ide
    git pull
) else (
    echo Cloning repository...
    git clone https://github.com/ch1kim0n1/ribix-ide.git
    cd ribix-ide
)

REM Install dependencies
echo 📦 Installing dependencies...
call npm ci

REM Build React components
echo 🔨 Building React components...
call npm run buildreact

REM Compile TypeScript
echo 🔨 Compiling TypeScript (this may take 8-10 minutes)...
call npm run compile

REM Download Electron
echo ⬇️  Downloading Electron...
node build/lib/preLaunch.js

REM Create desktop shortcut
echo 🖥️  Creating desktop shortcut...
set SCRIPT_DIR=%CD%
set SHORTCUT_PATH=%USERPROFILE%\Desktop\Ribix IDE.lnk
set TARGET=%SCRIPT_DIR%\scripts\code.bat

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET%'; $s.Arguments = '--user-data-dir %USERPROFILE%\.ribix-ide\user-data --extensions-dir %USERPROFILE%\.ribix-ide\extensions'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Save()"

echo.
echo ✅ Installation complete!
echo.
echo 🚀 To launch Ribix IDE:
echo    Double-click the desktop shortcut
echo    Or run: %SCRIPT_DIR%\scripts\code.bat --user-data-dir %USERPROFILE%\.ribix-ide\user-data --extensions-dir %USERPROFILE%\.ribix-ide\extensions
echo.
echo 📚 For more information, visit https://github.com/ch1kim0n1/ribix-ide
pause