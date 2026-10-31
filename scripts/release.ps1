# 发版脚本：自增版本 -> 提交 -> 打 tag ->（可选）打包 ->（可选）推送
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 -Bump minor -Build -Push
# 参数：
#   -Bump   patch | minor | major（默认 patch）
#   -Build  打包安装包（调用 scripts\build-installer.ps1）
#   -Push   推送提交与 tag 到 origin
$ErrorActionPreference = 'Stop'

param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  [switch]$Build,
  [switch]$Push
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

# 1) 自增版本号
$newVersion = (& $node scripts\bump-version.js $Bump | Select-Object -Last 1).Trim()
if (-not $newVersion) { throw '版本号自增失败' }
$tag = "v$newVersion"

# 2) 提交 + 打 tag
git add package.json
git commit -m "chore(release): $tag" | Out-Null
git tag -a $tag -m "BiliWhaleMusic $tag"

Write-Output "版本: $tag"

# 3) 可选打包
if ($Build) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-installer.ps1')
  if ($LASTEXITCODE -ne 0) { throw '打包失败' }
}

# 4) 可选推送
if ($Push) {
  git push origin HEAD --follow-tags
  if ($LASTEXITCODE -ne 0) { throw '推送失败，检查 remote 与凭据' }
}

Write-Output "完成: $tag"
