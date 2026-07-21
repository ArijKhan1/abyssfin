# Extract MSVC runtime DLLs for CI (same output as dev/windows/setup.bat).
$ErrorActionPreference = "Stop"

$deps = Join-Path (Get-Location) "deps"
New-Item -ItemType Directory -Force -Path $deps | Out-Null

$vcRedist = Join-Path $deps "vc_redist.x64.exe"
if (-not (Test-Path $vcRedist)) {
    Write-Host "Downloading vc_redist.x64.exe..."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcRedist
}

$vcruntime = Join-Path $deps "vcruntime"
if (Test-Path $vcruntime) {
    Write-Host "VC runtime already bundled at $vcruntime"
    exit 0
}

$wixDir = Join-Path $deps "wix"
$dark = Join-Path $wixDir "dark.exe"
if (-not (Test-Path $dark)) {
    Write-Host "Downloading WiX tools..."
    $wixZip = Join-Path $deps "wix.zip"
    Invoke-WebRequest -Uri "https://github.com/wixtoolset/wix3/releases/download/wix3111rtm/wix311-binaries.zip" -OutFile $wixZip
    Expand-Archive $wixZip -DestinationPath $wixDir -Force
}

Write-Host "Extracting VC runtime DLLs..."
New-Item -ItemType Directory -Force -Path $vcruntime | Out-Null
$tmp = Join-Path $deps "vcredist_tmp"
& $dark -nologo $vcRedist -x $tmp

$minimumCab = Join-Path $tmp "AttachedContainer/packages/vcRuntimeMinimum_amd64/cab1.cab"
$additionalCab = Join-Path $tmp "AttachedContainer/packages/vcRuntimeAdditional_amd64/cab1.cab"
expand.exe -F:* $minimumCab $vcruntime
expand.exe -F:* $additionalCab $vcruntime

Get-ChildItem (Join-Path $vcruntime "*_amd64") | ForEach-Object {
    $dllName = $_.Name -replace '_amd64$', '.dll'
    Rename-Item -Path $_.FullName -NewName $dllName
}

Remove-Item $tmp -Recurse -Force
Write-Host "VC runtime DLLs ready in $vcruntime"
