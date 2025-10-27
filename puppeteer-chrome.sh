#!/bin/bash
echo "Installing Chrome for Puppeteer..."
cd /home/site/wwwroot
# download same build Puppeteer expects (~130 MB)
wget -q https://storage.googleapis.com/chrome-for-testing-public/123.0.6312.58/linux64/chrome-linux64.zip -O chrome.zip
unzip -q chrome.zip && mv chrome-linux64 chrome-linux
rm chrome.zip
# mark executable
chmod +x chrome-linux/chrome
echo "Chrome ready at $(pwd)/chrome-linux/chrome"