$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Work = $PSScriptRoot
$AudioDir = Join-Path $Work "audio"
$ClipDir = Join-Path $Work "clips"
$FrameDir = Join-Path $Work "frames"
$OutDir = Join-Path $Work "out"
$ShotDir = Join-Path $Root "docs\video-screenshots\clean-original"
$MusicPath = "D:\File\Document\Videso\介绍.flac"

New-Item -ItemType Directory -Force -Path $AudioDir, $ClipDir, $FrameDir, $OutDir | Out-Null

$Scenes = @(
  @{ title="魔导书 Grimoire v7.1"; image="title"; text="这是魔导书 Grimoire v7.1，一款面向 AI 创作者的本地提示词组合工具。它把标签库、提示词整理、AI 聊天、识图和自由工作区放到一个桌面应用里。"; },
  @{ title="标签库"; image="01-tag-library-expanded.png"; text="左侧是内置标签库，包含四千五百多个中英对照标签。标签按大类、子类和具体标签组织，适合从镜头、人物、服饰、表情、动作和场景中快速取词。"; },
  @{ title="提示词组合"; image="02-prompt-composition-in-use.png"; text="点击标签后，正面提示词会立即汇总到下方。每个标签都带有权重滑块，可以快速调整重点，并一键复制中文或英文提示词。"; },
  @{ title="搜索筛选"; image="03-search-filter-in-use.png"; text="当标签很多时，可以直接搜索关键词。无论是中文词还是英文词，都能快速筛选出相关标签，减少翻找时间。"; },
  @{ title="收藏常用标签"; image="04-favorites-view.png"; text="常用标签和子类可以加入收藏。收藏页把高频素材单独聚合起来，适合长期项目、固定画风或角色设定的重复使用。"; },
  @{ title="自由多面板"; image="05-layout-menu-and-presets.png"; text="v7.1 重点升级了工作区系统。面板可以切换、分割、合并和关闭，也可以保存布局预设，逻辑接近 Blender 的自由面板工作流。"; },
  @{ title="AI 工作区"; image="06-ai-workspace.png"; text="AI 工作区用于对话和提示词辅助。它支持独立对话列表、多模型配置，也可以和主界面的简易 AI 面板保持使用习惯一致。"; },
  @{ title="AI 识图"; image="07-vision-workspace.png"; text="识图工作区用于上传参考图，让 AI 分析画面内容，并辅助反推可用标签。这个流程可以把图片观察和提示词整理连接起来。"; },
  @{ title="图片参考"; image="08-image-reference-workspace.png"; text="图片参考工作区用来管理参考图和历史素材。做系列创作时，可以把图片、历史和提示词面板放在同一个操作环境里。"; },
  @{ title="标签管理"; image="09-tag-management-workspace.png"; text="标签管理工作区面向整理和维护。你可以管理标签、预设、分类和标签组，让自己的提示词库持续积累。"; },
  @{ title="显示设置"; image="10-settings-general.png"; text="设置页支持字体大小、界面密度和随机标签范围。字体使用像素滑块控制，方便在不同屏幕尺寸下找到合适的显示比例。"; },
  @{ title="主题外观"; image="11-settings-appearance.png"; text="外观设置可以调整主题、强调色、背景色和边框色。v7.1 同时优化了顶部栏、面板边界、按钮状态和弹出菜单的可见性。"; },
  @{ title="独立 AI 助手"; image="12-ai-window.png"; text="AI 助手也可以作为独立窗口使用。需要专心聊天、识图或调试模型配置时，可以从主界面分离出来。"; },
  @{ title="本地与便携"; image="02-prompt-composition-in-use.png"; text="应用面向 Windows 桌面，支持安装包、单文件免安装版和 ZIP 便携版。数据保存在本地，更适合个人创作流程和长期素材管理。"; },
  @{ title="v7.1 总结"; image="outro"; text="如果你需要一个能管理标签、组合提示词、接入 AI，并且可以自由调整工作区的软件，魔导书 Grimoire v7.1 可以作为你的本地创作控制台。"; }
)

function New-CardImage {
  param(
    [string]$Path,
    [string]$Title,
    [string]$Subtitle
  )
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap(1920, 1080)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $bg = [System.Drawing.Color]::FromArgb(15, 15, 26)
  $panel = [System.Drawing.Color]::FromArgb(31, 28, 54)
  $accent = [System.Drawing.Color]::FromArgb(168, 85, 247)
  $text = [System.Drawing.Color]::FromArgb(244, 241, 255)
  $muted = [System.Drawing.Color]::FromArgb(178, 172, 205)
  $g.Clear($bg)
  $brushAccent = New-Object System.Drawing.SolidBrush($accent)
  $brushPanel = New-Object System.Drawing.SolidBrush($panel)
  $brushText = New-Object System.Drawing.SolidBrush($text)
  $brushMuted = New-Object System.Drawing.SolidBrush($muted)
  $g.FillRectangle($brushPanel, 190, 210, 1540, 560)
  $g.FillRectangle($brushAccent, 190, 210, 12, 560)
  $fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 78, [System.Drawing.FontStyle]::Bold)
  $fontSub = New-Object System.Drawing.Font("Microsoft YaHei UI", 32, [System.Drawing.FontStyle]::Regular)
  $g.DrawString($Title, $fontTitle, $brushText, 260, 330)
  $format = New-Object System.Drawing.StringFormat
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $rect = New-Object System.Drawing.RectangleF(265, 470, 1300, 180)
  $g.DrawString($Subtitle, $fontSub, $brushMuted, $rect, $format)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function New-SceneImage {
  param(
    [string]$SourcePath,
    [string]$Path,
    [string]$Title,
    [string]$Subtitle,
    [int]$Index
  )
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile($SourcePath)
  $bmp = New-Object System.Drawing.Bitmap(1920, 1080)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $g.DrawImage($src, 0, 0, 1920, 1080)

  $glass = [System.Drawing.Color]::FromArgb(202, 13, 13, 24)
  $panel = New-Object System.Drawing.SolidBrush($glass)
  $accent = [System.Drawing.Color]::FromArgb(178, 168, 85, 247)
  $accentBrush = New-Object System.Drawing.SolidBrush($accent)
  $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 246, 255))
  $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(194, 188, 218))
  $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 168, 85, 247), 2)
  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 0, 0, 0))

  # Cinematic software-promo title panel.
  $g.FillRectangle($shadowBrush, 68, 62, 610, 132)
  $g.FillRectangle($panel, 60, 54, 610, 132)
  $g.DrawRectangle($borderPen, 60, 54, 610, 132)
  $g.FillRectangle($accentBrush, 60, 54, 8, 132)

  $fontIndex = New-Object System.Drawing.Font("Microsoft YaHei UI", 20, [System.Drawing.FontStyle]::Bold)
  $fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 40, [System.Drawing.FontStyle]::Bold)
  $fontSub = New-Object System.Drawing.Font("Microsoft YaHei UI", 22, [System.Drawing.FontStyle]::Regular)
  $g.DrawString(("{0:00}" -f $Index), $fontIndex, $accentBrush, 88, 78)
  $g.DrawString($Title, $fontTitle, $textBrush, 145, 70)
  $rect = New-Object System.Drawing.RectangleF(145, 128, 480, 44)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $g.DrawString($Subtitle, $fontSub, $mutedBrush, $rect, $fmt)

  # Subtle safe-area frame so the screenshot feels like part of a composed promo.
  $safePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(58, 255, 255, 255), 1)
  $g.DrawRectangle($safePen, 28, 28, 1864, 1024)

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
}

function Format-SrtTime {
  param([double]$Seconds)
  $ts = [TimeSpan]::FromSeconds($Seconds)
  return "{0:00}:{1:00}:{2:00},{3:000}" -f [Math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds, $ts.Milliseconds
}

function Escape-FilterPath {
  param([string]$Path)
  return ($Path -replace "\\", "/") -replace ":", "\:"
}

New-CardImage -Path (Join-Path $FrameDir "title.png") -Title "魔导书 Grimoire v7.1" -Subtitle "AI 提示词组合器 / 自由多面板工作区 / 本地创作工具箱"
New-CardImage -Path (Join-Path $FrameDir "outro.png") -Title "Grimoire v7.1" -Subtitle "下载免安装版，开始整理你的提示词工作流"

Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice("Microsoft Huihui Desktop")
$speaker.Rate = 0
$speaker.Volume = 100

$concatLines = @()
$srtLines = @()
$cursor = 0.0
$sceneMeta = @()

for ($i = 0; $i -lt $Scenes.Count; $i++) {
  $idx = $i + 1
  $rawWav = Join-Path $AudioDir ("voice-{0:00}-raw.wav" -f $idx)
  $wav = Join-Path $AudioDir ("voice-{0:00}.wav" -f $idx)
  $speaker.SetOutputToWaveFile($rawWav)
  $speaker.Speak($Scenes[$i].text)
  $speaker.SetOutputToNull()
  & ffmpeg -y -hide_banner -loglevel error -i $rawWav -af "apad=pad_dur=0.45" $wav
  Remove-Item $rawWav -Force
  $duration = [double](& ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 $wav)
  $sceneMeta += @{ index=$idx; duration=$duration; start=$cursor; end=$cursor + $duration; title=$Scenes[$i].title; text=$Scenes[$i].text; image=$Scenes[$i].image }
  $srtLines += "$idx"
  $srtLines += "$(Format-SrtTime $cursor) --> $(Format-SrtTime ($cursor + $duration - 0.18))"
  $srtLines += $Scenes[$i].text
  $srtLines += ""
  $cursor += $duration
}

Set-Content -Path (Join-Path $OutDir "grimoire-v7.1-intro.srt") -Value $srtLines -Encoding UTF8

for ($i = 0; $i -lt $sceneMeta.Count; $i++) {
  $idx = $sceneMeta[$i].index
  $duration = [Math]::Ceiling($sceneMeta[$i].duration * 1000) / 1000
  $frames = [Math]::Max(1, [Math]::Ceiling($duration * 30))
  $imageName = $sceneMeta[$i].image
  if ($imageName -eq "title") { $image = Join-Path $FrameDir "title.png" }
  elseif ($imageName -eq "outro") { $image = Join-Path $FrameDir "outro.png" }
  else {
    $sourceImage = Join-Path $ShotDir $imageName
    $image = Join-Path $FrameDir ("scene-{0:00}.png" -f $idx)
    New-SceneImage -SourcePath $sourceImage -Path $image -Title $sceneMeta[$i].title -Subtitle $sceneMeta[$i].text -Index $idx
  }
  $wav = Join-Path $AudioDir ("voice-{0:00}.wav" -f $idx)
  $clip = Join-Path $ClipDir ("clip-{0:00}.mp4" -f $idx)
  $fadeOutStart = [Math]::Max(0.2, $duration - 0.42)
  $vf = "scale=1920:1080,zoompan=z='1+0.025*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.28,fade=t=out:st=${fadeOutStart}:d=0.42,format=yuv420p"
  & ffmpeg -y -hide_banner -loglevel error -loop 1 -framerate 30 -i $image -i $wav -t $duration -vf $vf -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest $clip
  $concatLines += "file 'clips/clip-{0:00}.mp4'" -f $idx
}

$concatPath = Join-Path $Work "concat.txt"
Set-Content -Path $concatPath -Value $concatLines -Encoding ASCII
$tempMp4 = Join-Path $OutDir "grimoire-v7.1-intro-no-subs.mp4"
$mixedMp4 = Join-Path $OutDir "grimoire-v7.1-intro-mixed.mp4"
$finalMp4 = Join-Path $OutDir "grimoire-v7.1-intro-1080p.mp4"
$srtPath = Join-Path $OutDir "grimoire-v7.1-intro.srt"
Push-Location $Work
& ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "concat.txt" -c copy $tempMp4
Pop-Location
if (Test-Path $MusicPath) {
  & ffmpeg -y -hide_banner -loglevel error -i $tempMp4 -stream_loop -1 -i $MusicPath -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.16,atrim=0:$cursor,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.2,afade=t=out:st=$([Math]::Max(0, $cursor - 2)):d=2[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest $mixedMp4
} else {
  Copy-Item $tempMp4 $mixedMp4 -Force
}
& ffmpeg -y -hide_banner -loglevel error -i $mixedMp4 -i $srtPath -map 0:v -map 0:a -map 1:0 -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=chi -metadata:s:s:0 title="中文字幕" -movflags +faststart $finalMp4

$summary = @{
  output = $finalMp4
  subtitles = $srtPath
  durationSeconds = [Math]::Round($cursor, 2)
  scenes = $sceneMeta
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $OutDir "render-summary.json") -Encoding UTF8
Write-Host "OUTPUT=$finalMp4"
Write-Host "SRT=$srtPath"
Write-Host "DURATION=$([Math]::Round($cursor, 2))"
