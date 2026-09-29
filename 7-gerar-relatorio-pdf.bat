@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Gerar o relatorio em PDF com a logo da empresa
echo  (so LE a marca cadastrada no sistema - nao altera nada)
echo ============================================================
echo.
node scripts\gerar-relatorio-pdf.cjs
echo.
pause
