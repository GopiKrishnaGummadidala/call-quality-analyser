<#
.SYNOPSIS
  Generates the demo/test bank-call recordings from data/calls.json (Windows only).

.DESCRIPTION
  Every utterance is synthesised separately with Windows text-to-speech (System.Speech, voice
  "Microsoft Zira Desktop"; each speaker role gets its own rate/pitch), trimmed, and placed on a
  timeline with natural pauses. Utterances with "overlapMs" start before the previous one ends and are
  mixed sample-by-sample, which produces real overlapping speech. Because the timeline is built here,
  the exact start/end of every segment is known: that is the ground truth written to the manifest.

  Outputs
    backend/src/main/resources/audio/<clipId>.wav             16 kHz, 16-bit, mono PCM (served only via the API)
    backend/src/main/resources/fixtures/calls/manifest.json        timings + scenario, read by the seeder

  The data is fully synthetic (invented bank, people and accounts). Re-run after editing data/calls.json:
    powershell -ExecutionPolicy Bypass -File scripts/generate-audio.ps1
#>
[CmdletBinding()]
param(
  [string]$Voice = 'Microsoft Zira Desktop',
  [int]$SampleRate = 16000
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'data/calls.json'
$audioDir = Join-Path $root 'backend/src/main/resources/audio'
$manifestDir = Join-Path $root 'backend/src/main/resources/fixtures/calls'
New-Item -ItemType Directory -Force -Path $audioDir, $manifestDir | Out-Null

Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.IO;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;

public static class CallTts {
    /// Speaks SSML to 16-bit mono PCM and trims leading/trailing silence (keeps 10 ms of padding).
    public static short[] Speak(SpeechSynthesizer synth, string ssml, int rate) {
        using (var ms = new MemoryStream()) {
            synth.SetOutputToAudioStream(ms, new SpeechAudioFormatInfo(rate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            synth.SpeakSsml(ssml);
            synth.SetOutputToNull();
            byte[] bytes = ms.ToArray();
            short[] pcm = new short[bytes.Length / 2];
            Buffer.BlockCopy(bytes, 0, pcm, 0, pcm.Length * 2);
            const int threshold = 250;
            int a = 0;
            while (a < pcm.Length && Math.Abs((int)pcm[a]) < threshold) a++;
            int z = pcm.Length - 1;
            while (z > a && Math.Abs((int)pcm[z]) < threshold) z--;
            int pad = rate / 100;
            a = Math.Max(0, a - pad);
            z = Math.Min(pcm.Length - 1, z + pad);
            short[] trimmed = new short[z - a + 1];
            Array.Copy(pcm, a, trimmed, 0, trimmed.Length);
            return trimmed;
        }
    }

    /// Adds a clip into the mix buffer at the given offset, clamping to the 16-bit range.
    public static void MixInto(int[] mix, short[] clip, int offset) {
        for (int i = 0; i < clip.Length; i++) mix[offset + i] += clip[i];
    }

    public static void WriteWav(string path, int[] mix, int rate) {
        using (var fs = new FileStream(path, FileMode.Create))
        using (var w = new BinaryWriter(fs)) {
            int dataLen = mix.Length * 2;
            w.Write(new char[] { 'R', 'I', 'F', 'F' }); w.Write(36 + dataLen);
            w.Write(new char[] { 'W', 'A', 'V', 'E' });
            w.Write(new char[] { 'f', 'm', 't', ' ' }); w.Write(16); w.Write((short)1); w.Write((short)1);
            w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
            w.Write(new char[] { 'd', 'a', 't', 'a' }); w.Write(dataLen);
            foreach (int s in mix) w.Write((short)Math.Max(short.MinValue, Math.Min(short.MaxValue, s)));
        }
    }
}
'@

$data = Get-Content -Raw -Encoding UTF8 $source | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)

function Get-Ssml([string]$text, [string]$pitch) {
  $escaped = [System.Security.SecurityElement]::Escape($text)
  "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><prosody pitch='$pitch'>$escaped</prosody></speak>"
}

$msPerSample = 1000.0 / $SampleRate
$calls = New-Object System.Collections.ArrayList
foreach ($d in $data.calls) {
  $clips = @(); $placed = New-Object System.Collections.ArrayList
  $cursor = [int]($SampleRate * 0.35)            # short lead-in before the first word
  $previousSpeaker = $null
  $index = 0
  foreach ($seg in $d.segments) {
    $v = $data.voices.($seg.speaker)
    $synth.Rate = [int]$v.rate
    $pcm = [CallTts]::Speak($synth, (Get-Ssml $seg.text $v.pitch), $SampleRate)
    if ($seg.overlapMs) {
      $start = [Math]::Max(0, $lastEnd - [int]($seg.overlapMs / $msPerSample))
    } else {
      $gapMs = if ($previousSpeaker -and $previousSpeaker -ne $seg.speaker) { 650 } else { 420 }
      $start = if ($index -eq 0) { $cursor } else { $cursor + [int]($gapMs / $msPerSample) }
    }
    $end = $start + $pcm.Length
    $clips += , @($pcm, $start)
    $label = if ($seg.label) { $seg.label } else { 'CLEAR' }
    [void]$placed.Add([ordered]@{
      id = ('s{0}' -f ($index + 1)); speaker = $seg.speaker; label = $label
      startMs = [int][Math]::Round($start * $msPerSample); endMs = [int][Math]::Round($end * $msPerSample)
      text = $seg.text
    })
    $lastEnd = $end
    $cursor = [Math]::Max($cursor, $end)
    $previousSpeaker = $seg.speaker
    $index++
  }
  $total = $cursor + [int]($SampleRate * 0.5)       # short tail after the last word
  $mix = New-Object int[] $total
  foreach ($c in $clips) { [CallTts]::MixInto($mix, $c[0], $c[1]) }
  $wav = Join-Path $audioDir ("{0}.wav" -f $d.clipId)
  [CallTts]::WriteWav($wav, $mix, $SampleRate)
  $durationMs = [int][Math]::Round($total * $msPerSample)

  $entry = [ordered]@{
    clipId = $d.clipId; project = $d.project; title = $d.title; assignee = $d.assignee; status = $d.status
    prefill = $d.prefill; audioUrl = "/audio/$($d.clipId).wav"; durationMs = $durationMs
    review = $d.review; speakerMistake = $d.speakerMistake; segments = [object[]]$placed.ToArray()
  }
  [void]$calls.Add($entry)
  Write-Host ("{0,-8} {1,6} ms  {2} segments  {3}" -f $d.clipId, $durationMs, $placed.Count, $d.title)
}
$synth.Dispose()

$manifest = [ordered]@{
  generatedBy = 'scripts/generate-audio.ps1'
  voice = $Voice
  sampleRate = $SampleRate
  calls = [object[]]$calls.ToArray()
  scorecards = [object[]]@($data.scorecards)
}
$json = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $manifestDir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $($calls.Count) clips to $audioDir and the manifest to $manifestDir"
