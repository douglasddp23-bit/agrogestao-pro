// Processo principal do Electron.
//
// O que este arquivo faz, em português simples:
// 1. Descobre onde estão os arquivos do app (a pasta do projeto, tanto em
//    desenvolvimento quanto depois de instalado no PC do usuário).
// 2. Sobe o servidor Node/Express (dist/server.cjs) como um processo filho,
//    exatamente como "npm start" faria — só que automaticamente.
// 3. Espera o servidor responder em http://localhost:3000/api/health.
// 4. Abre uma janela nativa apontando para essa URL. A partir daí, o app
//    funciona como sempre funcionou (Firebase, Gemini, e-mail, WhatsApp
//    continuam batendo na internet normalmente — só a "casca" é local).

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.AGROGESTAO_PORT || 3000;
// 127.0.0.1 explícito: o servidor escuta só em IPv4 local, e "localhost" pode resolver para IPv6 (::1).
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const APP_URL = `http://localhost:${PORT}`;

// Em desenvolvimento (npm run electron:dev) os arquivos ficam na raiz do
// projeto. Já empacotado, o electron-builder copia tudo para
// process.resourcesPath/app (veja "extraResources" em package.json).
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

let mainWindow = null;
let serverProcess = null;

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('O servidor local não respondeu a tempo.'));
        return;
      }
      setTimeout(tryOnce, 400);
    };
    tryOnce();
  });
}

function startServer() {
  const serverEntry = path.join(APP_ROOT, 'dist', 'server.cjs');

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AGROGESTAO_PORT: String(PORT),
      // Faz o Electron usar seu próprio Node embutido para rodar o script,
      // sem precisar que o usuário tenha Node instalado no PC.
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
  serverProcess.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));

  serverProcess.on('exit', (code) => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox(
        'AgroGestão Pro',
        'O servidor local encerrou inesperadamente. Feche e abra o aplicativo novamente.'
      );
    }
  });
}

// O Firebase faz login do Google abrindo um pop-up (accounts.google.com).
// Por padrão o Google recusa esse pop-up dentro do Electron porque o
// "User-Agent" identifica o app como Electron, não como um navegador comum.
// Usamos um User-Agent de Chrome normal para o pop-up ser aceito.
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function isAuthPopupUrl(url) {
  return (
    /^https:\/\/accounts\.google\.com\//.test(url) ||
    /^https:\/\/apis\.google\.com\//.test(url) ||
    /^https:\/\/[^/]+\.firebaseapp\.com\//.test(url)
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'AgroGestão Pro',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setUserAgent(CHROME_USER_AGENT);

  // SEGURANÇA: só estes tipos de link podem ser entregues ao Windows. Antes
  // qualquer endereço ia para shell.openExternal — um link com protocolo
  // especial (file:, ms-msdt:, search-ms:...) pode executar programas no PC.
  const isSafeExternalUrl = (url) => /^(https?:|mailto:|tel:|whatsapp:)/i.test(url);

  // Links externos de verdade (ex: WhatsApp Web, PDFs em nova aba) abrem no
  // navegador padrão do usuário. O pop-up de login do Google precisa abrir
  // como uma janela de verdade dentro do app, senão o Firebase não recebe
  // a resposta do login.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // blob: = arquivos do dossiê guardados no banco (PDF/imagem), abertos numa janela do próprio app.
    if (url.startsWith(APP_URL) || url.startsWith('blob:' + APP_URL) || isAuthPopupUrl(url)) {
      return { action: 'allow' };
    }
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // A janela principal nunca sai do próprio app (evita ser levada para um site falso).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    }
  });

  // Permissões do navegador: só o que o app usa (GPS do check-in, microfone do ditado, notificações).
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const fromApp = (details.requestingUrl || '').startsWith(APP_URL);
    callback(fromApp && ['geolocation', 'media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.setUserAgent(CHROME_USER_AGENT);
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer(HEALTH_URL);
  } catch (err) {
    dialog.showErrorBox(
      'AgroGestão Pro',
      'Não foi possível iniciar o servidor local. Verifique o arquivo .env.local e tente novamente.'
    );
    app.quit();
    return;
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
