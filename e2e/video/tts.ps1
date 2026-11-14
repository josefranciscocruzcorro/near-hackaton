# Generates one WAV per scene and language with the voices installed on this Windows machine.
#   English: Microsoft Zira (SAPI)   ·   Spanish: Microsoft Laura (OneCore, more natural)
# Usage: powershell -File tts.ps1 -Scenes scenes.json -OutDir <dir>
param(
    [Parameter(Mandatory = $true)][string]$Scenes,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$EnglishVoice = 'Microsoft Zira Desktop',
    [string]$SpanishVoice = 'Microsoft Laura'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'en'), (Join-Path $OutDir 'es') | Out-Null
$items = Get-Content -Raw -Encoding UTF8 $Scenes | ConvertFrom-Json

# English: SAPI
$sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
$sapi.SelectVoice($EnglishVoice)
$sapi.Rate = 0
foreach ($s in $items) {
    $path = Join-Path (Join-Path $OutDir 'en') "$($s.id).wav"
    $sapi.SetOutputToWaveFile($path)
    $sapi.Speak($s.en)
    $sapi.SetOutputToNull()
    "en $($s.id)"
}
$sapi.Dispose()

# Spanish: OneCore
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $SpanishVoice } | Select-Object -First 1
foreach ($s in $items) {
    $path = Join-Path (Join-Path $OutDir 'es') "$($s.id).wav"
    $stream = Await ($synth.SynthesizeTextToStreamAsync($s.es)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    [void](Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
    $bytes = New-Object byte[] ([int]$stream.Size)
    $reader.ReadBytes($bytes)
    [IO.File]::WriteAllBytes($path, $bytes)
    $reader.Dispose(); $stream.Dispose()
    "es $($s.id)"
}
