@echo off
cd /d "%~dp0"
echo ============================================================
echo  Instalar as CHAVES do AgroGestao Pro neste computador
echo  (.env.local e service-account.json)
echo.
echo  O instalador NAO leva mais essas chaves (seguranca).
echo  Este arquivo copia as chaves da MESMA pasta onde ele esta
echo  para a pasta protegida do Windows:
echo     %APPDATA%\AgroGestaoPro
echo  e deixa essa pasta acessivel so para o seu usuario.
echo ============================================================
echo.
if not exist ".env.local" (
  echo NAO encontrei o arquivo .env.local nesta pasta:
  echo   %~dp0
  echo Copie este .bat para a pasta onde estao as chaves ^(Cofre Pessoal^) e rode de novo.
  pause
  exit /b 1
)
set DEST=%APPDATA%\AgroGestaoPro
if not exist "%DEST%" mkdir "%DEST%"
copy /Y ".env.local" "%DEST%\.env.local" >nul
if exist "service-account.json" (
  copy /Y "service-account.json" "%DEST%\service-account.json" >nul
  echo - service-account.json copiado.
) else (
  echo - AVISO: service-account.json nao encontrado. O backup automatico e o
  echo   login pelo servidor precisam dele neste computador.
)
echo - .env.local copiado.
rem Somente o usuario atual (e o sistema) podem ler a pasta das chaves
icacls "%DEST%" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "SYSTEM:(OI)(CI)F" >nul
echo.
echo Pronto! Chaves instaladas em %DEST%
echo Agora abra o AgroGestao Pro normalmente.
pause
