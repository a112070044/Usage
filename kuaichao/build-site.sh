#!/usr/bin/env bash
# Builds site/index.html (the GitHub Pages / PWA version) from index.html (the claude.ai artifact version).
set -euo pipefail
cd "$(dirname "$0")"
end=$(grep -n '^</style>' index.html | head -1 | cut -d: -f1)
{
  cat <<'HEAD'
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="阿華熱炒：3D 快炒店網頁遊戲。客人一直點菜，甩鍋、鍋鏟翻炒、油炸，賺錢升級店面。">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#120e0c">
<link rel="icon" type="image/png" sizes="32x32" href="icon-32.png">
<link rel="apple-touch-icon" href="icon-180.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="阿華熱炒">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); box-sizing: border-box; height: 100%; }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
HEAD
  sed -n "1,${end}p" index.html
  echo '</head>'
  echo '<body>'
  sed -n "$((end + 1)),\$p" index.html
  echo "<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>"
  echo '</body>'
  echo '</html>'
} > site/index.html
echo "built site/index.html"
