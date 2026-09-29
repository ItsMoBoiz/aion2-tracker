<#
  Bundles public/ into one self-contained page: dist/aion2-tracker.html
  (CSS and JS inlined). This is the file published as the shareable claude.ai link.
  Live updates are switched off in this version; it has no server to check.

  Usage:  powershell -ExecutionPolicy Bypass -File tools\build-single-file.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$public = Join-Path $root 'public'
$dist = Join-Path $root 'dist'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$css = [IO.File]::ReadAllText((Join-Path $public 'css\styles.css'), $utf8)
$js = [IO.File]::ReadAllText((Join-Path $public 'js\app.js'), $utf8)
if ($js -match '</script' -or $css -match '</style') { throw 'Source contains a closing tag that would break inlining.' }

$html = @"
<title>Aion 2 - Progress Tracker</title>
<meta name="theme-color" content="#0a0d17">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800;6..12,900&display=swap">
<style>
$css
</style>
<div id="app"></div>
<div id="modal-root"></div>
<div id="toasts" aria-live="polite"></div>
<script>
$js
</script>
"@

New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist 'aion2-tracker.html'
[IO.File]::WriteAllText($out, $html, $utf8)
Write-Host "Built $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
