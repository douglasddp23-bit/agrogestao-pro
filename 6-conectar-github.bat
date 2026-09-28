@echo off
echo ============================================================
echo  Conectar sua conta do GitHub a este computador
echo ============================================================
echo.
echo 1. Vai aparecer um CODIGO de 8 letras (ex: ABCD-1234). ANOTE.
echo 2. Aperte Enter quando pedir: o navegador vai abrir no GitHub.
echo 3. Entre na sua conta, cole o codigo e clique em Authorize.
echo.
"C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --web
echo.
"C:\Program Files\GitHub CLI\gh.exe" auth setup-git
echo.
"C:\Program Files\GitHub CLI\gh.exe" auth status
echo.
echo Pronto. Pode fechar esta janela e avisar no chat.
pause
