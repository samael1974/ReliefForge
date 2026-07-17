@echo off
title ReliefForge 8.4 - Creazione setup .exe (NON CHIUDERE questa finestra)
cd /d "%~dp0"
if exist build_ok.txt del build_ok.txt

echo ============================================================
echo   ReliefForge 8.4 - compilazione completa + SETUP .EXE
echo   NON chiudere questa finestra: servono alcuni minuti.
echo   Al termine comparira' FATTO! e si aprira' la cartella.
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRORE: Node.js non risulta installato. Scaricalo da https://nodejs.org
  pause
  exit /b 1
)

rem pnpm: se manca, prova corepack enable; se non ha i permessi
rem (EPERM su Program Files), usa "corepack pnpm" che non li richiede.
set "PNPM=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm non trovato. Provo ad attivarlo con Corepack...
  call corepack enable >nul 2>nul
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo Uso corepack pnpm - non servono permessi amministratore.
    set "PNPM=corepack pnpm"
  )
)

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/3] Installo le dipendenze (pnpm install)...
call %PNPM% install --config.confirm-modules-purge=false > "crea_setup_log.txt" 2>&1
if errorlevel 1 (
  echo ERRORE: pnpm install non riuscito. Vedi crea_setup_log.txt
  pause
  exit /b 1
)

echo [2/3] Compilo il frontend (vite build)...
call %PNPM% exec cross-env VITE_ELECTRON=1 vite build --base=./ >> "crea_setup_log.txt" 2>&1
if errorlevel 1 (
  echo ERRORE: build frontend non riuscita. Vedi crea_setup_log.txt
  pause
  exit /b 1
)

echo [3/3] Creo l'installer Windows (2-6 minuti, attendere)...
call %PNPM% exec electron-builder --win --x64 --publish never >> "crea_setup_log.txt" 2>&1
if errorlevel 1 (
  echo.
  echo ERRORE: creazione installer non riuscita. Vedi crea_setup_log.txt
  pause
  exit /b 1
)

echo OK > build_ok.txt
echo.
echo ============================================================
echo   FATTO! Installer creato in:
echo   release\ReliefForge-Setup-8.4.0.exe
echo ============================================================
echo.
start "" explorer "%~dp0release"
pause
