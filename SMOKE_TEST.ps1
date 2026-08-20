# ============================================================
#  ReliefForge - SMOKE TEST
#  1) tipi + lint  2) i tre controlli geometrici  3) avvia l'app
#  Uso:  .\SMOKE_TEST.ps1          (controlli, poi avvia l'app)
#        .\SMOKE_TEST.ps1 -SoloControlli   (non avvia l'app)
#        .\SMOKE_TEST.ps1 -SoloApp         (salta i controlli)
# ============================================================
param([switch]$SoloControlli, [switch]$SoloApp)

Set-Location -Path $PSScriptRoot
function Head($t) { Write-Host "`n$('=' * 60)" -ForegroundColor DarkGray; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('=' * 60) -ForegroundColor DarkGray }

Head "ReliefForge $((Get-Content package.json -Raw | ConvertFrom-Json).version) - smoke test"

$esiti = [ordered]@{}
if (-not $SoloApp) {
    $passi = [ordered]@{
        "Tipi + lint"                = { pnpm check }
        "Assieme cornice"            = { pnpm assembly:check }
        "Mesh adattiva"              = { pnpm adaptive:check }
        "Curva tonale"               = { pnpm curve:check }
        "Invarianza STL"             = { pnpm stl:check }
    }
    $i = 0
    foreach ($k in $passi.Keys) {
        $i++
        Head "$i/$($passi.Count)  $k"
        & $passi[$k]
        $esiti[$k] = ($LASTEXITCODE -eq 0)
    }

    Head "Riepilogo"
    foreach ($k in $esiti.Keys) {
        if ($esiti[$k]) { Write-Host "  [OK]      $k" -ForegroundColor Green }
        else            { Write-Host "  [FALLITO] $k" -ForegroundColor Red }
    }
    if ($esiti.Values -contains $false) {
        Write-Host "`n  Controlli falliti: l'app NON viene avviata." -ForegroundColor Red
        try { Read-Host "`nPremi INVIO per chiudere" | Out-Null } catch { }
        exit 1
    }
    Write-Host "`n  Controlli superati." -ForegroundColor Green
}

if ($SoloControlli) { try { Read-Host "`nPremi INVIO per chiudere" | Out-Null } catch { }; exit 0 }

Head "Avvio dell'app (Ctrl+C per chiudere)"
Write-Host @"
  Da provare a mano:
   1. Immagine -> 'Apri depth map' -> scegli un PNG di profondita'
   2. Leggi il pannello: bit, range usato, eventuali avvisi
   3. Guarda il rilievo in 3D: deve rispecchiare la depth map, non una sua rielaborazione
   4. Spunta 'Rielabora con i controlli di Profondita'' e verifica che cambi
   5. Esporta -> STL, e apri il file nello slicer
"@ -ForegroundColor DarkGray
Write-Host ""
pnpm electron:dev
