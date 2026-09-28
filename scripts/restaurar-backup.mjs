// Restaura um backup do banco de dados (Firestore) feito pelo AgroGestão.
// Passo a passo em português: veja BACKUP-E-RESTAURACAO.md
//
// Uso:
//   node scripts/restaurar-backup.mjs <arquivo.ndjson.gz>                 → só MOSTRA o que tem no backup (não grava nada)
//   node scripts/restaurar-backup.mjs <arquivo> --restaurar               → grava TUDO de volta no banco (pede confirmação)
//   node scripts/restaurar-backup.mjs <arquivo> --restaurar --colecao clients --colecao contracts
//                                                                          → grava só essas coleções
//   Opções extras:  --sim (pula a pergunta de confirmação)   --emulador (grava no banco de TESTE local)
//
// O que a restauração faz: cada documento do backup é gravado de volta com o
// mesmo caminho/ID, substituindo a versão atual. Documentos criados DEPOIS do
// backup não são apagados.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--colecao'));
const doRestore = args.includes('--restaurar');
const skipConfirm = args.includes('--sim');
const useEmulator = args.includes('--emulador');
const onlyCollections = args.flatMap((a, i) => (a === '--colecao' && args[i + 1] ? [args[i + 1]] : []));

if (!file || !fs.existsSync(file)) {
  console.log('Informe o arquivo de backup. Exemplo:');
  console.log('  node scripts/restaurar-backup.mjs "%USERPROFILE%\\Documents\\AgroGestao-Backups\\firestore-backup-2026-09-28_10-00.ndjson.gz"');
  process.exit(1);
}

function decodeValue(v, admin, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => decodeValue(x, admin, db));
  switch (v.__t) {
    case 'ts': return new admin.firestore.Timestamp(v.s, v.n);
    case 'geo': return new admin.firestore.GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.p);
    case 'bytes': return Buffer.from(v.b64, 'base64');
    case 'vec': return admin.firestore.FieldValue.vector(v.v);
  }
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = decodeValue(val, admin, db);
  return out;
}

async function* readLines(f) {
  const rl = readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

function wanted(p) {
  return onlyCollections.length === 0 || onlyCollections.includes(p.split('/')[0]);
}

// 1. Resumo do backup
const counts = {};
let header = null;
let total = 0;
for await (const rec of readLines(file)) {
  if (rec.__header) { header = rec; continue; }
  const top = rec.p.split('/')[0];
  counts[top] = (counts[top] || 0) + 1;
  total++;
}
console.log(`\nBackup: ${path.basename(file)}`);
if (header) console.log(`Criado em: ${new Date(header.createdAt).toLocaleString('pt-BR')}  ·  projeto: ${header.projectId}  ·  motivo: ${header.reason}`);
console.log(`Total: ${total} documentos\n`);
for (const [c, n] of Object.entries(counts).sort()) console.log(`  ${wanted(c + '/x') ? '•' : ' '} ${c.padEnd(32)} ${n}`);

if (!doRestore) {
  console.log('\nNada foi gravado (modo de consulta). Para restaurar, rode de novo com --restaurar.');
  process.exit(0);
}

// 2. Conexão com o banco
if (useEmulator) process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require(path.join(ROOT, 'node_modules', 'firebase-admin'));
const saPath = path.join(ROOT, 'service-account.json');
if (!useEmulator && !fs.existsSync(saPath)) {
  console.error('Falta o arquivo service-account.json na pasta do sistema (chave de administrador do Firebase).');
  process.exit(1);
}
const sa = fs.existsSync(saPath) ? JSON.parse(fs.readFileSync(saPath, 'utf-8')) : null;
admin.initializeApp({
  projectId: header?.projectId || sa?.project_id,
  ...(sa ? { credential: admin.credential.cert(sa) } : {}),
});
const db = admin.firestore();

const alvo = useEmulator ? 'BANCO DE TESTE (emulador local)' : `BANCO REAL do projeto "${admin.app().options.projectId}"`;
const qtd = Object.entries(counts).filter(([c]) => wanted(c + '/x')).reduce((s, [, n]) => s + n, 0);
console.log(`\nATENÇÃO: ${qtd} documentos serão gravados no ${alvo},`);
console.log('substituindo a versão atual desses documentos.');

if (!skipConfirm) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(r => rl.question('Para continuar, digite RESTAURAR e aperte Enter: ', r));
  rl.close();
  if (answer.trim().toUpperCase() !== 'RESTAURAR') {
    console.log('Cancelado. Nada foi gravado.');
    process.exit(0);
  }
}

// 3. Gravação
const writer = db.bulkWriter();
let failed = 0;
writer.onWriteError(err => {
  if (err.failedAttempts < 3) return true;
  failed++;
  console.error(`  erro em ${err.documentRef.path}: ${err.message}`);
  return false;
});
let done = 0;
for await (const rec of readLines(file)) {
  if (rec.__header || !wanted(rec.p)) continue;
  writer.set(db.doc(rec.p), decodeValue(rec.d, admin, db));
  if (++done % 500 === 0) console.log(`  ${done}/${qtd}...`);
}
await writer.close();
console.log(`\nRestauração concluída: ${done - failed} documentos gravados${failed ? `, ${failed} com erro` : ''}.`);
process.exit(failed ? 1 : 0);
