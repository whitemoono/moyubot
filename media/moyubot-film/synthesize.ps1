param([string]$FilmDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$story = Get-Content -Raw -Encoding utf8 (Join-Path $FilmDirectory 'story.json') | ConvertFrom-Json
$voiceDirectory = Join-Path $FilmDirectory 'output\voice'
New-Item -ItemType Directory -Path $voiceDirectory -Force | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 0
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
for ($i=0; $i -lt $story.cues.Count; $i++) {
  $file = Join-Path $voiceDirectory ('voice-{0:D2}.wav' -f $i)
  $synth.SetOutputToWaveFile($file,$format)
  $spoken = $story.cues[$i].text.Replace('MoyuBot','摸鱼 Bot').Replace('Bot','机器人').Replace('MCP','M C P').Replace('GitHub','Git Hub')
  $synth.Speak($spoken)
  $synth.SetOutputToNull()
  Write-Output ('Narration {0}/{1}' -f ($i+1),$story.cues.Count)
}
$synth.Dispose()
