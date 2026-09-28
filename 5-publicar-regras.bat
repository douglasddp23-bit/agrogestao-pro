@echo off
cd /d "%~dp0"
echo ============================================================
echo  Publicar as regras de seguranca do banco (Firestore)
echo  - Contratos e Financeiro: so Gerente e Administrador
echo  A versao atual sera guardada antes, para poder desfazer.
echo ============================================================
echo.
set /p OK=Digite SIM e aperte Enter para publicar:
if /I not "%OK%"=="SIM" (
  echo Cancelado. Nada foi alterado.
  pause
  exit /b
)
echo.
node scripts\publicar-regras.cjs
echo.
pause
