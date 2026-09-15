param(
  [string]$OutputPath = "artifacts/wander-promo/wander-voiceover.wav"
)

$ErrorActionPreference = "Stop"

$output = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($output)) | Out-Null
$text = Get-Content -Raw ([System.IO.Path]::GetFullPath("promo/voiceover.txt"))

$speaker = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream
try {
  $canadianVoice = @($speaker.GetVoices()) | Where-Object { $_.GetDescription() -match "Linda|Canada" } | Select-Object -First 1
  if ($canadianVoice) { $speaker.Voice = $canadianVoice }
  $speaker.Rate = 0
  $speaker.Volume = 100
  $stream.Open($output, 3, $false)
  $speaker.AudioOutputStream = $stream
  [void]$speaker.Speak($text)
}
finally {
  try { $stream.Close() } catch {}
  [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream) | Out-Null
  [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($speaker) | Out-Null
}

Write-Output $output
