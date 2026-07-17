@echo off
title ReliefForge - Pubblica aggiornamento su GitHub
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo ERRORE: git non trovato.
  pause
  exit /b 1
)

echo Commit delle modifiche...
git add -A
git commit -m "Aggiornamento ReliefForge"
echo.
echo Aggiorno il tag v8.4.0 e invio tutto a GitHub...
git push origin main
git tag -f v8.4.0
git push -f origin v8.4.0
if errorlevel 1 (
  echo.
  echo ERRORE: push non riuscito. Se e' apparso un login GitHub, completalo e rilancia.
  pause
  exit /b 1
)
echo.
echo ============================================================
echo   FATTO! Modifiche pubblicate: la build riparte da sola.
echo   Controlla tra ~10 min: github.com/samael1974/ReliefForge/releases
echo ============================================================
pause
