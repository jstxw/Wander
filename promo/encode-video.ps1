param(
  [string]$Ffmpeg = ".wander-video-deps/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath("artifacts/wander-promo")
$frames = Join-Path $root "frames/frame-%04d.jpg"
$audioMaster = Join-Path $root "wander-promo.webm"
$output = Join-Path $root "wander-promo.mp4"

& ([System.IO.Path]::GetFullPath($Ffmpeg)) -y -framerate 15 -i $frames -i $audioMaster -map 0:v:0 -map 1:a:0 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart $output
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed with exit code $LASTEXITCODE" }

Write-Output $output
