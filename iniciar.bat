@echo off
rem Abre o site no servidor de desenvolvimento (Vite) e no navegador. Para parar, feche esta janela.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if not exist node_modules (
  echo Instalando as dependencias pela primeira vez...
  call npm install
)
echo.
echo  Simulador dos tuneis de negociacao: http://localhost:5173
echo  Para parar, feche esta janela.
echo.
call npm run dev -- --open
