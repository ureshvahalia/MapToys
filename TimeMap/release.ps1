# Usage: .\release.ps1 1.0.3
# Bumps electron/package.json, commits, pushes, tags, and triggers the CI build.

param(
    [Parameter(Mandatory)][string]$Version
)

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be x.y.z (e.g. 1.0.3)"
    exit 1
}

$tag = "v$Version"

# Check for an existing tag
if (git tag --list $tag) {
    Write-Error "Tag $tag already exists. Delete it first: git tag -d $tag && git push origin --delete $tag"
    exit 1
}

# Bump version in electron/package.json
$pkgPath = Join-Path $PSScriptRoot "electron\package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding utf8NoBOM

Write-Host "Bumped electron/package.json to $Version"

# Commit and push
git add electron/package.json
git commit -m "Bump version to $Version"
git push

# Tag and push - this triggers the GitHub Actions build
git tag $tag
git push origin $tag

Write-Host ""
Write-Host "Released $tag - GitHub Actions will build the installers." -ForegroundColor Green
Write-Host "Track progress: gh run watch" -ForegroundColor DarkGray
