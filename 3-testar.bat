@echo off
cd /d "%~dp0"
echo ============================================
echo  Abrindo o AgroGestao Pro para teste...
echo  (isso NAO gera o instalador, e so uma
echo  janela de teste. Pode fechar quando quiser)
echo ============================================
call npm run electron:dev
pause
