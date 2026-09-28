@echo off
cd /d "%~dp0"
echo ============================================
echo  Gerando o instalador do AgroGestao Pro...
echo  Isso pode demorar alguns minutos.
echo ============================================
call npm run dist:win
echo.
echo ============================================
echo  Pronto! Procure o arquivo .exe dentro da
echo  pasta "release" que apareceu aqui do lado.
echo ============================================
explorer "release"
pause
