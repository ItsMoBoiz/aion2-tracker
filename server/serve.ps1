<#
  Aion 2 - Progress Tracker: fallback web server for Windows PowerShell 5.1+.
  Same behaviour as server.py (use that when Python 3 is installed):
    - no-cache headers + ETags, so browsers always check for a newer file
    - __BUILD__ in index.html is replaced by a hash of all app files
    - GET /__version lists file hashes; open pages use it to update live

  Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-NoBrowser]
#>
param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$RootFull = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public'))
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
}

$DigestCache = @{}

function Get-ShortSha1([byte[]]$Bytes) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try { (([BitConverter]::ToString($sha.ComputeHash($Bytes))) -replace '-', '').Substring(0, 12).ToLower() }
  finally { $sha.Dispose() }
}

function Get-Digest([System.IO.FileInfo]$File) {
  $key = "$($File.FullName)|$($File.LastWriteTimeUtc.Ticks)|$($File.Length)"
  if (-not $DigestCache.ContainsKey($key)) {
    $DigestCache[$key] = Get-ShortSha1 ([System.IO.File]::ReadAllBytes($File.FullName))
  }
  $DigestCache[$key]
}

function Get-Snapshot {
  $files = [ordered]@{}
  Get-ChildItem -LiteralPath $RootFull -Recurse -File |
    Where-Object { -not $_.Name.StartsWith('.') } |
    Sort-Object FullName |
    ForEach-Object {
      $rel = $_.FullName.Substring($RootFull.Length).TrimStart('\', '/').Replace('\', '/')
      try { $files[$rel] = Get-Digest $_ } catch { }  # file mid-save; next poll picks it up
    }
  $joined = ($files.Keys | ForEach-Object { "$_=$($files[$_])" }) -join ';'
  @{ build = (Get-ShortSha1 ($Utf8.GetBytes($joined))); files = $files }
}

# Official AION 2 announcements, relayed for the app: GET /api/news and /api/news/<id>.
$NewsApi = 'https://api-global-community.plaync.com/aion2_global/board/notice_en/article'
$NewsPage = 'https://aion2.plaync.com/en-us/board/notice/list'
$NewsHeaders = @{ Referer = 'https://aion2.plaync.com/'; Origin = 'https://aion2.plaync.com'; Accept = 'application/json' }
$NewsCache = @{}

function Get-NewsJson([string]$Url) {
  $r = Invoke-WebRequest $Url -UseBasicParsing -Headers $NewsHeaders -TimeoutSec 15 -UserAgent 'Mozilla/5.0 (Aion2ProgressTracker)'
  $Utf8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Get-NewsItem($a) {
  $ts = $a.timestamps
  [ordered]@{
    id        = "$($a.id)"
    title     = "$($a.title)".Trim()
    summary   = "$($a.summary)"
    thumb     = "$($a.thumbnailUrl)"
    postedAt  = [int64]$ts.postedEpoch * 1000
    updatedAt = [int64]$ts.updatedEpoch * 1000
    url       = "https://aion2.plaync.com/en-us/board/notice/view?articleId=$($a.id)"
  }
}

function Get-Cached([string]$Key, [int]$TtlSeconds, [scriptblock]$Load) {
  $hit = $NewsCache[$Key]
  if ($hit -and ((Get-Date) - $hit.At).TotalSeconds -lt $TtlSeconds) { return $hit.Json }
  $json = & $Load
  $NewsCache[$Key] = @{ At = Get-Date; Json = $json }
  $json
}

function Get-NewsResponse([string]$ArticleId) {
  if (-not $ArticleId) {
    return Get-Cached 'list' 600 {
      $data = Get-NewsJson "${NewsApi}?isVote=true&moreSize=15&moreDirection=BEFORE&previousArticleId=0"
      $items = @($data.contentList | Where-Object { $_.id } | ForEach-Object { Get-NewsItem $_ })
      $now = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      [ordered]@{ updatedAt = $now; source = $NewsPage; items = $items } | ConvertTo-Json -Depth 5 -Compress
    }
  }
  Get-Cached "article:$ArticleId" 1800 {
    $data = Get-NewsJson "$NewsApi/$ArticleId"
    $item = Get-NewsItem $data.article.contentMeta
    $item.id = $ArticleId
    $item.url = "https://aion2.plaync.com/en-us/board/notice/view?articleId=$ArticleId"
    $item.html = "$($data.article.content.content)"
    $item | ConvertTo-Json -Depth 5 -Compress
  }
}

function Send-Response($Ctx, [int]$Code, [byte[]]$Body, [string]$Type, [string]$ETag) {
  $res = $Ctx.Response
  $res.StatusCode = $Code
  $res.Headers['Cache-Control'] = 'no-cache, must-revalidate'
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  if ($ETag) { $res.Headers['ETag'] = $ETag }
  if ($Type) { $res.ContentType = $Type }
  if ($Body) {
    $res.ContentLength64 = $Body.Length
    if ($Ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($Body, 0, $Body.Length) }
  }
  $res.Close()
}

function Invoke-Request($Ctx) {
  $req = $Ctx.Request
  $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

  if ($path -eq '/__version') {
    $s = Get-Snapshot
    $json = (@{ build = $s.build; files = $s.files } | ConvertTo-Json -Compress)
    Send-Response $Ctx 200 ($Utf8.GetBytes($json)) 'application/json' $null
    return
  }

  if ($path -eq '/api/news' -or $path.StartsWith('/api/news/')) {
    $id = if ($path.StartsWith('/api/news/')) { $path.Substring(10) } else { '' }
    if ($id -and $id -notmatch '^[0-9a-f]{24}$') {
      Send-Response $Ctx 404 ($Utf8.GetBytes('{"error":"unknown article"}')) 'application/json' $null
      return
    }
    try {
      Send-Response $Ctx 200 ($Utf8.GetBytes((Get-NewsResponse $id))) 'application/json' $null
    } catch {
      $msg = (@{ error = "Could not reach the official news: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
      Send-Response $Ctx 502 ($Utf8.GetBytes($msg)) 'application/json' $null
    }
    return
  }

  if ($path -eq '/') { $path = '/index.html' }
  $full = [System.IO.Path]::GetFullPath((Join-Path $RootFull $path.TrimStart('/')))
  $inside = $full.StartsWith($RootFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
  if (-not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
    Send-Response $Ctx 404 ($Utf8.GetBytes('Not found')) 'text/plain; charset=utf-8' $null
    return
  }

  $file = Get-Item -LiteralPath $full
  $ext = $file.Extension.ToLower()
  $type = if ($Mime.ContainsKey($ext)) { $Mime[$ext] } else { 'application/octet-stream' }

  if ($file.Name -eq 'index.html') {
    $s = Get-Snapshot
    $etag = '"' + $s.build + '"'
    if ($req.Headers['If-None-Match'] -eq $etag) { Send-Response $Ctx 304 $null $null $etag; return }
    $text = [System.IO.File]::ReadAllText($full, $Utf8).Replace('__BUILD__', $s.build)
    Send-Response $Ctx 200 ($Utf8.GetBytes($text)) $type $etag
    return
  }

  $etag = '"' + (Get-Digest $file) + '"'
  if ($req.Headers['If-None-Match'] -eq $etag) { Send-Response $Ctx 304 $null $null $etag; return }
  Send-Response $Ctx 200 ([System.IO.File]::ReadAllBytes($full)) $type $etag
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${Port}/")
try { $listener.Start() }
catch {
  Write-Host "Could not start on port ${Port}: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Try another port:  serve.ps1 -Port 8081"
  exit 1
}

$url = "http://localhost:${Port}/"
Write-Host 'Aion 2 - Progress Tracker (PowerShell server)' -ForegroundColor Cyan
Write-Host "  Serving : $RootFull"
Write-Host "  Open    : $url"
Write-Host '  Edits to files in public\ reach open pages within ~2 seconds.'
Write-Host '  Press Ctrl+C to stop.'
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $pending = $listener.GetContextAsync()
    while (-not $pending.AsyncWaitHandle.WaitOne(250)) { }  # short waits keep Ctrl+C responsive
    $ctx = $pending.GetAwaiter().GetResult()
    try {
      Invoke-Request $ctx
      if ($ctx.Request.Url.AbsolutePath -ne '/__version') {
        Write-Host ("{0:HH:mm:ss} {1} {2} {3}" -f (Get-Date), $ctx.Request.HttpMethod, $ctx.Request.Url.AbsolutePath, $ctx.Response.StatusCode)
      }
    }
    catch {
      try { Send-Response $ctx 500 ($Utf8.GetBytes('Server error')) 'text/plain; charset=utf-8' $null } catch { }
      Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
