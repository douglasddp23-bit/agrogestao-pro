// Backup automático do banco de dados (Firestore).
//
// Em português simples: uma vez por dia o servidor do AgroGestão (que roda
// junto com o aplicativo neste computador) lê TODOS os documentos do banco,
// inclusive as subcoleções, e grava uma cópia compactada numa pasta do PC:
//   Documentos\AgroGestao-Backups\firestore-backup-AAAA-MM-DD_HH-MM.ndjson.gz
// Guarda os 30 backups mais recentes e apaga os mais antigos.
//
// Por que não usar a exportação oficial do Google (Cloud Functions + Cloud
// Storage)? Ela exige o plano pago Blaze e o Cloud Storage ativado — este
// projeto usa o plano gratuito. Este backup usa só o Admin SDK (a chave
// service-account.json que já está neste PC) e não custa nada, mas cada
// backup conta como 1 leitura por documento na cota gratuita diária (50 mil).
//
// Como restaurar: veja BACKUP-E-RESTAURACAO.md (script scripts/restaurar-backup.mjs).
import { Request, Response } from 'express';
import admin from 'firebase-admin';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const KEEP_BACKUPS = Number(process.env.BACKUP_KEEP || 30);
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FILE_PREFIX = 'firestore-backup-';
const STATUS_FILE = 'ultimo-backup.json';

export function backupDir(): string {
  const custom = (process.env.BACKUP_DIR || '').replace(/['"]/g, '').trim();
  return custom || path.join(os.homedir(), 'Documents', 'AgroGestao-Backups');
}

interface BackupStatusInfo {
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastDocs: number;
  lastBytes: number;
  lastDurationMs: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

let running: Promise<BackupStatusInfo> | null = null;

function readStatus(): BackupStatusInfo {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir(), STATUS_FILE), 'utf-8'));
  } catch {
    return { lastSuccessAt: null, lastFile: null, lastDocs: 0, lastBytes: 0, lastDurationMs: 0, lastError: null, lastErrorAt: null };
  }
}

function writeStatus(s: BackupStatusInfo) {
  try {
    fs.writeFileSync(path.join(backupDir(), STATUS_FILE), JSON.stringify(s, null, 2));
  } catch {
    // pasta inacessível: o erro já aparece no log
  }
}

/** Sem credenciais de administrador (service-account.json) não há como ler o banco inteiro. */
export function backupAvailable(): boolean {
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  try {
    const cred: any = admin.app().options.credential;
    return !!cred && typeof cred.getAccessToken === 'function' && fs.existsSync(path.join(process.cwd(), 'service-account.json'));
  } catch {
    return false;
  }
}

// Converte os tipos especiais do Firestore em JSON "etiquetado", para a
// restauração conseguir recriar exatamente o mesmo tipo (data, referência...).
function encodeValue(v: any): any {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof admin.firestore.Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof admin.firestore.GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof admin.firestore.DocumentReference) return { __t: 'ref', p: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    if (typeof v.toArray === 'function' && v.constructor?.name === 'VectorValue') return { __t: 'vec', v: v.toArray() };
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = encodeValue(val);
    return out;
  }
  return v;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

async function doBackup(reason: string): Promise<BackupStatusInfo> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const finalName = `${FILE_PREFIX}${stamp()}.ndjson.gz`;
  const tmpPath = path.join(dir, finalName + '.parcial');
  const status = readStatus();

  const gzip = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(tmpPath);
  gzip.pipe(out);
  const write = (line: string) => new Promise<void>(resolve => {
    if (gzip.write(line + '\n')) resolve();
    else gzip.once('drain', resolve);
  });

  let docs = 0;
  const counts: Record<string, number> = {};
  try {
    const db = admin.firestore();
    await write(JSON.stringify({
      __header: true,
      format: 'agrogestao-firestore-backup/1',
      projectId: admin.app().options.projectId || null,
      createdAt: new Date().toISOString(),
      reason,
    }));

    // Percorre coleção → documentos → subcoleções (em qualquer profundidade).
    const walk = async (col: admin.firestore.CollectionReference) => {
      const snap = await col.get();
      for (const d of snap.docs) {
        await write(JSON.stringify({ p: d.ref.path, d: encodeValue(d.data()) }));
      }
      docs += snap.size;
      const top = col.path.split('/')[0];
      counts[top] = (counts[top] || 0) + snap.size;
      await mapLimit(snap.docs, 16, async (d) => {
        const subs = await d.ref.listCollections();
        for (const sub of subs) await walk(sub);
      });
    };
    for (const col of await db.listCollections()) await walk(col);

    await new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve());
      out.on('error', reject);
      gzip.end();
    });
    const finalPath = path.join(dir, finalName);
    fs.renameSync(tmpPath, finalPath);
    const bytes = fs.statSync(finalPath).size;

    // Rodízio: mantém só os KEEP_BACKUPS mais recentes.
    const all = fs.readdirSync(dir).filter(f => f.startsWith(FILE_PREFIX) && f.endsWith('.ndjson.gz')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignora */ }
    }

    const result: BackupStatusInfo = {
      ...status,
      lastSuccessAt: new Date().toISOString(),
      lastFile: finalName,
      lastDocs: docs,
      lastBytes: bytes,
      lastDurationMs: Date.now() - started,
      lastError: null,
      lastErrorAt: null,
    };
    writeStatus(result);
    console.log(`[Backup] Concluído (${reason}): ${docs} documentos, ${(bytes / 1024).toFixed(0)} KB → ${path.join(dir, finalName)}`, counts);
    return result;
  } catch (err: any) {
    gzip.destroy();
    out.destroy();
    try { fs.unlinkSync(tmpPath); } catch { /* ignora */ }
    const result: BackupStatusInfo = { ...status, lastError: String(err?.message || err).slice(0, 500), lastErrorAt: new Date().toISOString() };
    writeStatus(result);
    console.error('[Backup] Falhou:', err?.message || err);
    throw err;
  }
}

/** Roda um backup (nunca dois ao mesmo tempo). */
export function runBackup(reason: string): Promise<BackupStatusInfo> {
  if (!running) {
    running = doBackup(reason).finally(() => { running = null; });
  }
  return running;
}

/** Chamado de hora em hora e ao abrir o app: faz backup se o último tem mais de 24 h. */
export async function runBackupIfDue(): Promise<void> {
  if (!backupAvailable()) return;
  const last = readStatus().lastSuccessAt;
  if (last && Date.now() - new Date(last).getTime() < BACKUP_INTERVAL_MS) return;
  try {
    await runBackup('automático (diário)');
  } catch {
    // já registrado em ultimo-backup.json; tenta de novo na próxima hora
  }
}

function isAdminCaller(req: Request): boolean {
  return String((req as any).user?.role || '') === 'admin';
}

// GET /api/admin/backup/status
export async function backupStatus(req: Request, res: Response) {
  if (!isAdminCaller(req)) return res.status(403).json({ error: 'Somente o Administrador pode ver os backups.' });
  let files: { name: string; bytes: number }[] = [];
  try {
    files = fs.readdirSync(backupDir())
      .filter(f => f.startsWith(FILE_PREFIX) && f.endsWith('.ndjson.gz'))
      .sort().reverse()
      .map(name => ({ name, bytes: fs.statSync(path.join(backupDir(), name)).size }));
  } catch {
    // pasta ainda não existe
  }
  return res.json({
    available: backupAvailable(),
    running: !!running,
    folder: backupDir(),
    keep: KEEP_BACKUPS,
    ...readStatus(),
    files: files.slice(0, 10),
    totalFiles: files.length,
  });
}

// POST /api/admin/backup/run
export async function runBackupNow(req: Request, res: Response) {
  if (!isAdminCaller(req)) return res.status(403).json({ error: 'Somente o Administrador pode fazer backup.' });
  if (!backupAvailable()) {
    return res.status(400).json({ error: 'Backup indisponível neste computador: falta a chave service-account.json.' });
  }
  try {
    const result = await runBackup('manual');
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: 'O backup falhou: ' + String(err?.message || err).slice(0, 200) });
  }
}
