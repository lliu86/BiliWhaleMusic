# 打包 BiliWhaleMusic 安装包：纯 ASCII 构建目录放在 D:\biuwhale-build
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $PSScriptRoot          # 项目根（含中文路径）
$dst = 'D:\biuwhale-build'                        # 纯英文、D 盘
$npmDir = 'C:\Program Files\nodejs'               # 完整 npm 所在位置（DSH 自带 node 没有 npm）
$temp = 'D:\temp'

foreach ($p in @($dst, $temp)) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

# 临时文件也放 D 盘，避免往 C:\Users\...\Temp 写
$env:TMP = $temp
$env:TEMP = $temp
$env:PATH = "$npmDir;$env:PATH"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 1) 复制源码（跳过 node_modules / dist / userdata / shots / runtime / .git / *.log）
if (Test-Path $dst) {
  $j = Join-Path $dst 'node_modules'
  if (Test-Path $j) { cmd /c rmdir "$j" | Out-Null }   # 只删目录联接，不动真实 node_modules
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
}
New-Item -ItemType Directory -Path $dst | Out-Null

$files = @('main.js','preload-pet.js','preload-player.js','package.json','package-lock.json','LICENSE','NOTICE','README.md','README.en.md')
foreach ($f in $files) {
  $p = Join-Path $src $f
  if (Test-Path $p) { Copy-Item $p -Destination $dst -Force }
}
foreach ($d in @('src','renderer','assets','docs')) {
  $p = Join-Path $src $d
  if (Test-Path $p) { Copy-Item $p -Destination $dst -Recurse -Force }
}

# 2) 复用依赖：目录联接，别复制几百 MB
cmd /c mklink /J "$dst\node_modules" "$src\node_modules" | Out-Null

# 3) 打包
Push-Location $dst
try {
  & (Join-Path $dst 'node_modules\.bin\electron-builder.cmd') --win nsis
  if ($LASTEXITCODE -ne 0) { throw "electron-builder 退出码 $LASTEXITCODE" }
} finally {
  Pop-Location
}

# 4) 产物回项目
$dist = Join-Path $src 'dist'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
Copy-Item (Join-Path $dst 'dist\BiliWhaleMusic-Setup-1.0.0.exe') $dist -Force
Copy-Item (Join-Path $dst 'dist\BiliWhaleMusic-Setup-1.0.0.exe.blockmap') $dist -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $src 'dist\win-unpacked')) { Remove-Item (Join-Path $src 'dist\win-unpacked') -Recurse -Force }
Copy-Item (Join-Path $dst 'dist\win-unpacked') $dist -Recurse -Force

# 5) 清理构建目录（先删联接）
$j = Join-Path $dst 'node_modules'
if (Test-Path $j) { cmd /c rmdir "$j" | Out-Null }
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }

$exe = Join-Path $dist 'BiliWhaleMusic-Setup-1.0.0.exe'
$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "完成：$exe （$size MB）"
