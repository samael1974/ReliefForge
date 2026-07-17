@echo off
title ReliefForge - Prepara repository Git per GitHub
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo ERRORE: git non trovato nel PATH. Installa Git per Windows o apri Git CMD.
  pause
  exit /b 1
)

echo Rimuovo l'eventuale repository parziale...
if exist .git rmdir /s /q .git

echo Creo il repository e il commit iniziale...
git init -b main
git config user.name "Federico Cordioli"
git config user.email "federicocordioli1974@gmail.com"
git config core.autocrlf false
git add -A
git commit -m "ReliefForge V8.4 - installer Windows/macOS, fix cornice e depth map, CI GitHub Actions"
if errorlevel 1 (
  echo ERRORE: commit non riuscito.
  pause
  exit /b 1
)
git tag v8.4.0

echo.
echo ============================================================
echo   FATTO! Repository pronto (branch main, tag v8.4.0).
echo   Ora apri GitHub Desktop:
echo   1. File - Add local repository - scegli questa cartella
echo   2. Publish repository - nome: ReliefForge
echo      TOGLI la spunta "Keep this code private"
echo   3. Publica. Poi dimmi "pubblicato" nella chat di Claude.
echo ============================================================
echo.
pause
