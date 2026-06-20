#!/bin/bash

# Exit on error
set -e

# Check platform
platform=$(uname)

if [[ "$platform" == "Darwin" ]]; then
    echo "Running on macOS. Note that the AppImage created will only work on Linux systems."
    if ! command -v docker &> /dev/null; then
        echo "Docker Desktop for Mac is not installed. Please install it from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
elif [[ "$platform" == "Linux" ]]; then
    echo "Running on Linux. Proceeding with AppImage creation..."
else
    echo "This script is intended to run on macOS or Linux. Current platform: $platform"
    exit 1
fi

# Enable BuildKit
export DOCKER_BUILDKIT=1

BUILD_IMAGE_NAME="ribix-appimage-builder"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Check and install Buildx if needed
if ! docker buildx version >/dev/null 2>&1; then
    echo "Installing Docker Buildx..."
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/buildx/releases/download/v0.13.1/buildx-v0.13.1.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
    chmod +x ~/.docker/cli-plugins/docker-buildx
fi

# Download appimagetool if not present
if [ ! -f "appimagetool" ]; then
    echo "Downloading appimagetool..."
    wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool
fi

# Delete any existing AppImage to avoid bloating the build
rm -f Ribix-x86_64.AppImage

# Create build Dockerfile
echo "Creating build Dockerfile..."
cat > Dockerfile.build << 'EOF'
# syntax=docker/dockerfile:1
FROM ubuntu:20.04

# Install required dependencies
RUN apt-get update && apt-get install -y \
    libfuse2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EOF

# Create .dockerignore file
echo "Creating .dockerignore file..."
cat > .dockerignore << EOF
Dockerfile.build
.dockerignore
.git
.gitignore
.DS_Store
*~
*.swp
*.swo
*.tmp
*.bak
*.log
*.err
node_modules/
venv/
*.egg-info/
*.tox/
dist/
EOF

# Build Docker image without cache
echo "Building Docker image (no cache)..."
docker build --no-cache -t "$BUILD_IMAGE_NAME" -f Dockerfile.build .

# Create AppImage using local appimagetool
echo "Creating AppImage..."
docker run --rm --privileged -v "$(pwd):/app" "$BUILD_IMAGE_NAME" bash -c '
cd /app && \
rm -rf RibixApp.AppDir && \
mkdir -p RibixApp.AppDir/usr/bin RibixApp.AppDir/usr/lib RibixApp.AppDir/usr/share/applications && \
find . -maxdepth 1 ! -name RibixApp.AppDir ! -name "." ! -name ".." -exec cp -r {} RibixApp.AppDir/usr/bin/ \; && \
cp ribix.png RibixApp.AppDir/ && \
echo "[Desktop Entry]" > RibixApp.AppDir/ribix.desktop && \
echo "Name=Ribix IDE" >> RibixApp.AppDir/ribix.desktop && \
echo "Comment=Open source AI code editor." >> RibixApp.AppDir/ribix.desktop && \
echo "GenericName=Text Editor" >> RibixApp.AppDir/ribix.desktop && \
echo "Exec=ribix-ide %F" >> RibixApp.AppDir/ribix.desktop && \
echo "Icon=ribix" >> RibixApp.AppDir/ribix.desktop && \
echo "Type=Application" >> RibixApp.AppDir/ribix.desktop && \
echo "StartupNotify=false" >> RibixApp.AppDir/ribix.desktop && \
echo "StartupWMClass=RibixIDE" >> RibixApp.AppDir/ribix.desktop && \
echo "Categories=TextEditor;Development;IDE;" >> RibixApp.AppDir/ribix.desktop && \
echo "MimeType=application/x-ribix-workspace;" >> RibixApp.AppDir/ribix.desktop && \
echo "Keywords=ribix;" >> RibixApp.AppDir/ribix.desktop && \
echo "Actions=new-empty-window;" >> RibixApp.AppDir/ribix.desktop && \
echo "[Desktop Action new-empty-window]" >> RibixApp.AppDir/ribix.desktop && \
echo "Name=New Empty Window" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[de]=Neues leeres Fenster" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[es]=Nueva ventana vacía" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[fr]=Nouvelle fenêtre vide" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[it]=Nuova finestra vuota" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[ja]=新しい空のウィンドウ" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[ko]=새 빈 창" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[ru]=Новое пустое окно" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[zh_CN]=新建空窗口" >> RibixApp.AppDir/ribix.desktop && \
echo "Name[zh_TW]=開新空視窗" >> RibixApp.AppDir/ribix.desktop && \
echo "Exec=ribix-ide --new-window %F" >> RibixApp.AppDir/ribix.desktop && \
echo "Icon=ribix" >> RibixApp.AppDir/ribix.desktop && \
chmod +x RibixApp.AppDir/ribix.desktop && \
cp RibixApp.AppDir/ribix.desktop RibixApp.AppDir/usr/share/applications/ && \
echo "[Desktop Entry]" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Name=Ribix IDE - URL Handler" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Comment=Open source AI code editor." > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "GenericName=Text Editor" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Exec=ribix-ide --open-url %U" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Icon=ribix" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Type=Application" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "NoDisplay=true" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "StartupNotify=true" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Categories=Utility;TextEditor;Development;IDE;" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "MimeType=x-scheme-handler/ribix-ide;" > RibixApp.AppDir/ribix-url-handler.desktop && \
echo "Keywords=ribix;" > RibixApp.AppDir/ribix-url-handler.desktop && \
chmod +x RibixApp.AppDir/ribix-url-handler.desktop && \
cp RibixApp.AppDir/ribix-url-handler.desktop RibixApp.AppDir/usr/share/applications/ && \
echo "#!/bin/bash" > RibixApp.AppDir/AppRun && \
echo "HERE=\$(dirname \"\$(readlink -f \"\${0}\")\")" >> RibixApp.AppDir/AppRun && \
echo "export PATH=\${HERE}/usr/bin:\${PATH}" >> RibixApp.AppDir/AppRun && \
echo "export LD_LIBRARY_PATH=\${HERE}/usr/lib:\${LD_LIBRARY_PATH}" >> RibixApp.AppDir/AppRun && \
echo "exec \${HERE}/usr/bin/ribix-ide --no-sandbox \"\$@\"" >> RibixApp.AppDir/AppRun && \
chmod +x RibixApp.AppDir/AppRun && \
chmod -R 755 RibixApp.AppDir && \

# Strip unneeded symbols from the binary to reduce size
strip --strip-unneeded RibixApp.AppDir/usr/bin/ribix-ide

ls -la RibixApp.AppDir/ && \
ARCH=x86_64 ./appimagetool -n RibixApp.AppDir Ribix-x86_64.AppImage
'

# Clean up
rm -rf RibixApp.AppDir .dockerignore appimagetool

echo "AppImage creation complete! Your AppImage is: Ribix-x86_64.AppImage"
