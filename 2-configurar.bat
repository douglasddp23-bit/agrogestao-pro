@echo off
cd /d "%~dp0"
if not exist ".env.local" (
    copy ".env.example" ".env.local" >nul
    echo Arquivo .env.local criado a partir do modelo.
)
echo Abrindo o arquivo de configuracao no Bloco de Notas...
echo Preencha os valores do Firebase (e os outros que tiver) e SALVE o arquivo.
notepad ".env.local"
