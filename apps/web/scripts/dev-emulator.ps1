$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

foreach ($port in @(9099, 8081)) {
    if (-not (Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet)) {
        throw "Required Firebase emulator port $port is unavailable."
    }
}

$env:ORBOTRIQ_FIREBASE_MODE = "emulator"
$env:NEXT_PUBLIC_FIREBASE_MODE = "emulator"

$env:FIREBASE_PROJECT_ID = "demo-orbotriq-v2"
$env:GCLOUD_PROJECT = "demo-orbotriq-v2"
$env:GOOGLE_CLOUD_PROJECT = "demo-orbotriq-v2"

$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081"

$env:NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-orbotriq-v2"
$env:NEXT_PUBLIC_FIREBASE_API_KEY = "demo-api-key"
$env:NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "demo-orbotriq-v2.firebaseapp.com"
$env:NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "demo-orbotriq-v2.appspot.com"
$env:NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "123456789"
$env:NEXT_PUBLIC_FIREBASE_APP_ID = "1:123456789:web:orbotriq-demo"

Remove-Item Env:FIREBASE_CLIENT_EMAIL -ErrorAction SilentlyContinue
Remove-Item Env:FIREBASE_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue

$env:PORT = "8080"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ORBOTRIQ V2 - LOCAL EMULATOR MODE" -ForegroundColor Cyan
Write-Host " Project: demo-orbotriq-v2"
Write-Host " Auth: 127.0.0.1:9099"
Write-Host " Firestore: 127.0.0.1:8081"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm run dev
