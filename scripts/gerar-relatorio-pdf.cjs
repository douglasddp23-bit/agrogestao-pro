// Gera um relatório em PDF com a LOGO e o NOME da empresa cadastrados no sistema
// (tela "Configurar Marca"). Só LÊ a marca no banco — não altera nada.
//
// Uso (na pasta agrogestao-pro):
//   node scripts\gerar-relatorio-pdf.cjs                       → relatório de revisão mais recente
//   node scripts\gerar-relatorio-pdf.cjs ARQUIVO.html          → outro relatório em HTML
//
// O PDF é salvo na Área de Trabalho (e uma cópia na pasta do sistema).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const admin = require(path.join(ROOT, 'node_modules', 'firebase-admin'));

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-agrogestao' }); // teste
} else {
  const sa = require(path.join(ROOT, 'service-account.json'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function findEdge() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const b of bases) {
    for (const p of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) {
      const full = path.join(b, p);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

(async () => {
  const src = process.argv[2]
    ? path.resolve(ROOT, process.argv[2])
    : fs.readdirSync(ROOT).filter((f) => /^RELATORIO-.*\.html$/i.test(f)).map((f) => path.join(ROOT, f))
        .sort((x, y) => fs.statSync(x).mtimeMs - fs.statSync(y).mtimeMs).pop(); // o mais recente
  if (!src || !fs.existsSync(src)) throw new Error('Relatório HTML não encontrado.');

  console.log('1/3 Lendo a marca da empresa no sistema...');
  const snap = await admin.firestore().doc('settings/branding').get();
  const b = snap.exists ? snap.data() : {};
  const nome = (b.companyName || 'AgroGestão').trim();
  const frase = (b.companyPhrase || '').trim();
  const logo = b.companyLogo || '';
  const logoHtml = /^(data:image\/|https:\/\/)/i.test(logo)
    ? `<img src="${esc(logo)}" alt="Logo">`
    : `<span>${esc(nome[0] || 'A').toUpperCase()}</span>`;
  console.log(`    Empresa: ${nome}${logo ? ' (com logo)' : ' (sem logo cadastrada — usando a inicial)'}`);

  const html = fs.readFileSync(src, 'utf-8')
    .replaceAll('{{LOGO_HTML}}', logoHtml)
    .replaceAll('{{EMPRESA}}', esc(nome))
    .replaceAll('{{FRASE}}', esc(frase))
    .replaceAll('{{DATA}}', new Date().toLocaleString('pt-BR'));
  const tmpHtml = path.join(os.tmpdir(), 'agrogestao-relatorio.html');
  fs.writeFileSync(tmpHtml, html);

  console.log('2/3 Gerando o PDF...');
  const edge = findEdge();
  if (!edge) throw new Error('Microsoft Edge não encontrado para gerar o PDF.');
  const pdfName = path.basename(src).replace(/\.html$/i, '.pdf');
  const tmpPdf = path.join(os.tmpdir(), pdfName);
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--user-data-dir=${path.join(os.tmpdir(), 'agrogestao-edge-pdf')}`,
    `--print-to-pdf=${tmpPdf}`, 'file:///' + tmpHtml.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 120000 });
  if (!fs.existsSync(tmpPdf)) throw new Error('O PDF não foi gerado.');

  const outs = process.env.RELATORIO_SAIDA ? [path.join(process.env.RELATORIO_SAIDA, pdfName)] : [path.join(ROOT, pdfName)];
  if (!process.env.RELATORIO_SAIDA) for (const d of [path.join(os.homedir(), 'OneDrive', 'Área de Trabalho'), path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')]) {
    if (fs.existsSync(d)) { outs.unshift(path.join(d, pdfName)); break; }
  }
  for (const o of outs) fs.copyFileSync(tmpPdf, o);
  console.log('3/3 PRONTO. PDF salvo em:');
  outs.forEach((o) => console.log('    ' + o));
  process.exit(0);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
