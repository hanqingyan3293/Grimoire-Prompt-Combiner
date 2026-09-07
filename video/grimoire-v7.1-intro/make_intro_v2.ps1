$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Work = Join-Path $PSScriptRoot "v2"
$AudioDir = Join-Path $Work "audio"
$ClipDir = Join-Path $Work "clips"
$FrameDir = Join-Path $Work "frames"
$OutDir = Join-Path $Work "out"
$ShotDir = Join-Path $Root "docs\video-screenshots\clean-original"
$MusicPath = "D:\File\Document\Videso\介绍.flac"

New-Item -ItemType Directory -Force -Path $AudioDir, $ClipDir, $FrameDir, $OutDir | Out-Null

$Scenes = @(
  @{ key="title"; title="Grimoire v7.1"; image="02-prompt-composition-in-use.png"; duration=9.0; text="这是魔导书 Grimoire v7.1。它是一个 Windows 桌面提示词组合工具，用来管理标签、组合提示词和整理创作面板。"; motion="intro"; highlight=@(); cursor=@(); },
  @{ key="tags"; title="标签库"; image="01-tag-library-expanded.png"; duration=13.5; text="左侧是标签库。大类、子类和标签放在同一条浏览路径里，可以从人物、服饰、镜头、动作和场景中取词。"; motion="pan-right"; highlight=@(@{x=0;y=78;w=420;h=970}); cursor=@(@{x=54;y=118;t=0.5},@{x=126;y=350;t=3.2},@{x=214;y=650;t=6.2}); },
  @{ key="compose"; title="组合提示词"; image="02-prompt-composition-in-use.png"; duration=14.0; text="点击标签后，提示词会进入下方输出区。正面词和负面词分开显示，常用格式可以直接复制。"; motion="push-in"; highlight=@(@{x=420;y=108;w=1080;h=750},@{x=424;y=874;w=1076;h=160}); cursor=@(@{x=710;y=155;t=0.8},@{x=760;y=885;t=5.8},@{x=1420;y=932;t=9.2}); },
  @{ key="search"; title="搜索"; image="03-search-filter-in-use.png"; duration=11.5; text="标签很多时，可以直接搜索。中文和英文关键词都可以用，结果会在当前标签视图里收窄。"; motion="pan-left"; highlight=@(@{x=2;y=116;w=414;h=34},@{x=425;y=107;w=1080;h=760}); cursor=@(@{x=70;y=128;t=0.8},@{x=860;y=340;t=5.8}); },
  @{ key="favorites"; title="收藏"; image="04-favorites-view.png"; duration=11.0; text="常用标签可以加入收藏。收藏页会把常用标签集中放在一起，适合重复使用的角色、服饰和画风。"; motion="push-in"; highlight=@(@{x=16;y=88;w=360;h=64},@{x=430;y=110;w=1040;h=720}); cursor=@(@{x=327;y=97;t=0.8},@{x=720;y=250;t=5.0}); },
  @{ key="workspaces"; title="工作区"; image="05-layout-menu-and-presets.png"; duration=13.0; text="顶部可以切换创作、AI、识图、图片参考和标签管理。每个工作区保存自己的面板组合。"; motion="pan-right"; highlight=@(@{x=0;y=0;w=510;h=40},@{x=430;y=42;w=282;h=362}); cursor=@(@{x=45;y=17;t=0.8},@{x=118;y=17;t=2.0},@{x=196;y=17;t=3.2},@{x=500;y=60;t=6.0}); },
  @{ key="panels"; title="自由面板"; image="05-layout-menu-and-presets.png"; duration=15.0; text="面板可以左右或上下分割，也可以向相邻区域合并。布局可以保存为预设，再覆盖到当前工作区。"; motion="split"; highlight=@(@{x=410;y=40;w=1100;h=1010},@{x=430;y=218;w=585;h=40}); cursor=@(@{x=742;y=60;t=0.8},@{x=990;y=560;t=5.0},@{x=1605;y=560;t=8.2}); },
  @{ key="ai"; title="AI 面板"; image="06-ai-workspace.png"; duration=10.5; text="AI 工作区用于对话和提示词辅助。右下角的 AI 助手也可以从主界面打开。"; motion="pan-left"; highlight=@(@{x=420;y=42;w=1090;h=1010},@{x=1570;y=1040;w=170;h=38}); cursor=@(@{x=540;y=82;t=1.0},@{x=1642;y=1056;t=6.0}); },
  @{ key="vision"; title="识图"; image="07-vision-workspace.png"; duration=9.5; text="识图工作区用于图片分析。它可以把参考图和标签整理流程放在同一个界面里。"; motion="push-in"; highlight=@(@{x=420;y=42;w=1090;h=1010}); cursor=@(@{x=150;y=17;t=1.0},@{x=960;y=540;t=5.2}); },
  @{ key="refs"; title="图片参考"; image="08-image-reference-workspace.png"; duration=9.5; text="图片参考工作区用于管理参考图、历史素材和当前提示词。"; motion="pan-right"; highlight=@(@{x=420;y=42;w=1090;h=1010}); cursor=@(@{x=228;y=17;t=1.0},@{x=970;y=540;t=5.0}); },
  @{ key="manage"; title="标签管理"; image="09-tag-management-workspace.png"; duration=10.0; text="标签管理工作区用于维护标签、分类、标签组和预设。"; motion="push-in"; highlight=@(@{x=420;y=42;w=1090;h=1010}); cursor=@(@{x=320;y=17;t=1.0},@{x=705;y=160;t=5.4}); },
  @{ key="settings"; title="显示设置"; image="10-settings-general.png"; duration=12.5; text="设置里可以调整字体像素、界面密度和随机标签范围。不同屏幕可以用不同显示比例。"; motion="pan-left"; highlight=@(@{x=430;y=130;w=880;h=420}); cursor=@(@{x=1830;y=1056;t=0.8},@{x=820;y=286;t=4.8}); },
  @{ key="theme"; title="主题"; image="11-settings-appearance.png"; duration=11.5; text="主题页面可以调整界面颜色、强调色、背景色和面板边框。"; motion="push-in"; highlight=@(@{x=430;y=130;w=960;h=560}); cursor=@(@{x=615;y=168;t=1.0},@{x=870;y=436;t=5.5}); },
  @{ key="download"; title="发布文件"; image="02-prompt-composition-in-use.png"; duration=10.5; text="发布文件包含安装包、单文件免安装版和 ZIP 便携版。需要移动使用时，可以下载便携版本。"; motion="outro"; highlight=@(); cursor=@(); }
)

function Format-SrtTime {
  param([double]$Seconds)
  $ts = [TimeSpan]::FromSeconds($Seconds)
  return "{0:00}:{1:00}:{2:00},{3:000}" -f [Math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds, $ts.Milliseconds
}

function New-OverlayPng {
  param(
    [string]$Path,
    [string]$Title,
    [int]$Index,
    [string]$Kind
  )
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap(1920, 1080, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $panel = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(188, 10, 10, 18))
  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 151, 101, 255))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 244, 255))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 186, 215))
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(145, 151, 101, 255), 2)

  if ($Kind -eq "title") {
    $g.FillRectangle($panel, 126, 650, 940, 150)
    $g.FillRectangle($accent, 126, 650, 8, 150)
    $fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 58, [System.Drawing.FontStyle]::Bold)
    $fontSub = New-Object System.Drawing.Font("Microsoft YaHei UI", 24, [System.Drawing.FontStyle]::Regular)
    $g.DrawString("魔导书 Grimoire v7.1", $fontTitle, $white, 166, 668)
    $g.DrawString("Windows 桌面提示词组合工具", $fontSub, $muted, 170, 748)
  } elseif ($Kind -eq "outro") {
    $g.FillRectangle($panel, 126, 650, 960, 150)
    $g.FillRectangle($accent, 126, 650, 8, 150)
    $fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 52, [System.Drawing.FontStyle]::Bold)
    $fontSub = New-Object System.Drawing.Font("Microsoft YaHei UI", 24, [System.Drawing.FontStyle]::Regular)
    $g.DrawString("Grimoire v7.1", $fontTitle, $white, 166, 668)
    $g.DrawString("安装包 / 单文件免安装版 / ZIP 便携版", $fontSub, $muted, 170, 746)
  } else {
    $g.FillRectangle($panel, 62, 56, 360, 76)
    $g.DrawRectangle($pen, 62, 56, 360, 76)
    $fontIndex = New-Object System.Drawing.Font("Microsoft YaHei UI", 18, [System.Drawing.FontStyle]::Bold)
    $fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 31, [System.Drawing.FontStyle]::Bold)
    $g.DrawString(("{0:00}" -f $Index), $fontIndex, $accent, 88, 84)
    $g.DrawString($Title, $fontTitle, $white, 142, 72)
  }

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function New-CursorPng {
  param([string]$Path)
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $points = @(
    (New-Object System.Drawing.Point(8, 5)),
    (New-Object System.Drawing.Point(8, 50)),
    (New-Object System.Drawing.Point(20, 39)),
    (New-Object System.Drawing.Point(28, 58)),
    (New-Object System.Drawing.Point(38, 54)),
    (New-Object System.Drawing.Point(30, 36)),
    (New-Object System.Drawing.Point(48, 36))
  )
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(115, 0, 0, 0))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 245, 255))
  $outline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(35, 35, 48), 2)
  $g.TranslateTransform(3, 3)
  $g.FillPolygon($shadow, $points)
  $g.ResetTransform()
  $g.FillPolygon($white, $points)
  $g.DrawPolygon($outline, $points)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function Get-MotionFilter {
  param([string]$Motion, [double]$Duration, [int]$Frames)
  if ($Motion -eq "pan-right") {
    return "zoompan=z='1.055':x='(iw-iw/zoom)*on/${Frames}':y='(ih-ih/zoom)/2':d=${Frames}:s=1920x1080:fps=30"
  }
  if ($Motion -eq "pan-left") {
    return "zoompan=z='1.055':x='(iw-iw/zoom)*(1-on/${Frames})':y='(ih-ih/zoom)/2':d=${Frames}:s=1920x1080:fps=30"
  }
  if ($Motion -eq "push-in") {
    return "zoompan=z='1+0.045*on/${Frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Frames}:s=1920x1080:fps=30"
  }
  if ($Motion -eq "split") {
    return "zoompan=z='1+0.035*on/${Frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Frames}:s=1920x1080:fps=30"
  }
  return "zoompan=z='1+0.025*on/${Frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Frames}:s=1920x1080:fps=30"
}

function Get-HighlightFilters {
  param($Boxes)
  $filters = @()
  foreach ($box in $Boxes) {
    $area = [int]$box.w * [int]$box.h
    if ($area -lt 260000) {
      $filters += "drawbox=x=$($box.x):y=$($box.y):w=$($box.w):h=$($box.h):color=0x9765ff@0.055:t=fill"
    }
    $filters += "drawbox=x=$($box.x):y=$($box.y):w=$($box.w):h=$($box.h):color=0x9765ff@0.82:t=3"
  }
  return $filters
}

function Get-CursorOverlay {
  param($Points)
  if (-not $Points -or $Points.Count -eq 0) {
    return ""
  }
  $exprX = ""
  $exprY = ""
  for ($i = 0; $i -lt $Points.Count; $i++) {
    $p = $Points[$i]
    if ($i -eq 0) {
      $exprX = "$($p.x)"
      $exprY = "$($p.y)"
    } else {
      $prev = $Points[$i - 1]
      $dx = $p.x - $prev.x
      $dy = $p.y - $prev.y
      $dt = [Math]::Max(0.01, $p.t - $prev.t)
      $xSegment = "$($prev.x)+($dx)*(t-$($prev.t))/$dt"
      $ySegment = "$($prev.y)+($dy)*(t-$($prev.t))/$dt"
      $exprX = "if(gte(t\,$($prev.t))\,$xSegment\,$exprX)"
      $exprY = "if(gte(t\,$($prev.t))\,$ySegment\,$exprY)"
    }
  }
  return "overlay=x='$exprX':y='$exprY':shortest=1"
}

$cursorPng = Join-Path $FrameDir "cursor.png"
New-CursorPng -Path $cursorPng

Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice("Microsoft Huihui Desktop")
$speaker.Rate = 2
$speaker.Volume = 100

$srtLines = @()
$concatLines = @()
$cursorTime = 0.0
$sceneMeta = @()

for ($i = 0; $i -lt $Scenes.Count; $i++) {
  $idx = $i + 1
  $rawWav = Join-Path $AudioDir ("voice-{0:00}-raw.wav" -f $idx)
  $wav = Join-Path $AudioDir ("voice-{0:00}.wav" -f $idx)
  $speaker.SetOutputToWaveFile($rawWav)
  $speaker.Speak($Scenes[$i].text)
  $speaker.SetOutputToNull()
  & ffmpeg -y -hide_banner -loglevel error -i $rawWav -af "apad=pad_dur=0.16" $wav
  Remove-Item $rawWav -Force
  $voiceDuration = [double](& ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 $wav)
  $duration = [Math]::Max([double]$Scenes[$i].duration, $voiceDuration + 0.25)

  $srtLines += "$idx"
  $srtLines += "$(Format-SrtTime $cursorTime) --> $(Format-SrtTime ($cursorTime + $voiceDuration))"
  $srtLines += $Scenes[$i].text
  $srtLines += ""
  $sceneMeta += @{ index=$idx; start=$cursorTime; end=$cursorTime + $duration; duration=$duration; title=$Scenes[$i].title; text=$Scenes[$i].text }
  $cursorTime += $duration
}

$srtPath = Join-Path $OutDir "grimoire-v7.1-intro-v2.srt"
Set-Content -Path $srtPath -Value $srtLines -Encoding UTF8

for ($i = 0; $i -lt $Scenes.Count; $i++) {
  $idx = $i + 1
  $scene = $Scenes[$i]
  $duration = [double]$sceneMeta[$i].duration
  $frames = [Math]::Max(1, [Math]::Ceiling($duration * 30))
  $source = Join-Path $ShotDir $scene.image
  $overlay = Join-Path $FrameDir ("overlay-{0:00}.png" -f $idx)
  $kind = "normal"
  if ($scene.key -eq "title") { $kind = "title" }
  if ($scene.key -eq "download") { $kind = "outro" }
  New-OverlayPng -Path $overlay -Title $scene.title -Index $idx -Kind $kind

  $wav = Join-Path $AudioDir ("voice-{0:00}.wav" -f $idx)
  $clip = Join-Path $ClipDir ("clip-{0:00}.mp4" -f $idx)
  $motion = Get-MotionFilter -Motion $scene.motion -Duration $duration -Frames $frames
  $fadeOutStart = [Math]::Max(0.2, $duration - 0.24)
  $filters = @($motion)
  $filters += Get-HighlightFilters -Boxes $scene.highlight
  $filters += "fade=t=in:st=0:d=0.12"
  $filters += "fade=t=out:st=${fadeOutStart}:d=0.24"
  $filters += "format=rgba"
  $vfMain = $filters -join ","
  $cursorOverlay = Get-CursorOverlay -Points $scene.cursor

  if ($cursorOverlay -ne "") {
    $filterComplex = "[0:v]$vfMain[base];[base][2:v]$cursorOverlay[withcursor];[withcursor][1:v]overlay=0:0,format=yuv420p[v];[3:a]apad=whole_dur=${duration},atrim=0:${duration}[a]"
    & ffmpeg -y -hide_banner -loglevel error -loop 1 -framerate 30 -i $source -i $overlay -loop 1 -framerate 30 -i $cursorPng -i $wav -t $duration -filter_complex $filterComplex -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k $clip
  } else {
    $filterComplex = "[0:v]$vfMain[base];[base][1:v]overlay=0:0,format=yuv420p[v];[2:a]apad=whole_dur=${duration},atrim=0:${duration}[a]"
    & ffmpeg -y -hide_banner -loglevel error -loop 1 -framerate 30 -i $source -i $overlay -i $wav -t $duration -filter_complex $filterComplex -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k $clip
  }
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg scene render failed: $idx" }
  $concatLines += "file 'clips/clip-{0:00}.mp4'" -f $idx
}

$concatPath = Join-Path $Work "concat.txt"
Set-Content -Path $concatPath -Value $concatLines -Encoding ASCII
$tempMp4 = Join-Path $OutDir "grimoire-v7.1-intro-v2-no-subs.mp4"
$mixedMp4 = Join-Path $OutDir "grimoire-v7.1-intro-v2-mixed.mp4"
$finalMp4 = Join-Path $OutDir "grimoire-v7.1-intro-v2-1080p.mp4"

Push-Location $Work
& ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "concat.txt" -c copy $tempMp4
Pop-Location

$voiceStats = Join-Path $OutDir "voice-loudness.txt"
$musicStats = Join-Path $OutDir "music-loudness.txt"
cmd /c "ffmpeg -hide_banner -nostats -i `"$tempMp4`" -af volumedetect -vn -sn -dn -f null NUL 2> `"$voiceStats`""
if (Test-Path $MusicPath) {
  cmd /c "ffmpeg -hide_banner -nostats -i `"$MusicPath`" -t $cursorTime -af volumedetect -vn -sn -dn -f null NUL 2> `"$musicStats`""
  & ffmpeg -y -hide_banner -loglevel error -i $tempMp4 -stream_loop -1 -i $MusicPath -filter_complex "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a0];[1:a]atrim=0:$cursorTime,asetpts=PTS-STARTPTS,loudnorm=I=-28:TP=-3:LRA=11,afade=t=in:st=0:d=0.8,afade=t=out:st=$([Math]::Max(0, $cursorTime - 1.6)):d=1.6[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest $mixedMp4
} else {
  Copy-Item $tempMp4 $mixedMp4 -Force
}

& ffmpeg -y -hide_banner -loglevel error -i $mixedMp4 -i $srtPath -map 0:v -map 0:a -map 1:0 -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=chi -metadata:s:s:0 title="中文字幕" -movflags +faststart $finalMp4

$summary = @{
  output = $finalMp4
  subtitles = $srtPath
  durationSeconds = [Math]::Round($cursorTime, 2)
  voiceLoudnessLog = $voiceStats
  musicLoudnessLog = $musicStats
  scenes = $sceneMeta
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $OutDir "render-summary-v2.json") -Encoding UTF8
Write-Host "OUTPUT=$finalMp4"
Write-Host "SRT=$srtPath"
Write-Host "DURATION=$([Math]::Round($cursorTime, 2))"
Write-Host "VOICE_LOUDNESS=$voiceStats"
Write-Host "MUSIC_LOUDNESS=$musicStats"
