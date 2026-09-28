@echo off
cd /d "%~dp0"
echo ============================================
echo  Cadastro do Administrador Principal
echo ============================================
echo.
node scripts\criar-administrador.mjs
echo.
pause
