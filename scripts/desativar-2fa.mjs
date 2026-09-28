// EMERGÊNCIA: desliga a verificação em duas etapas de uma conta, caso o
// administrador tenha perdido o celular E os códigos de recuperação.
// Precisa do service-account.json (chave de administrador) nesta pasta.
//
// Uso:  node scripts/desativar-2fa.mjs email@da.conta
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const email = (process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
  console.log('Uso: node scripts/desativar-2fa.mjs email@da.conta');
  process.exit(1);
}

const admin = require(path.join(ROOT, 'node_modules', 'firebase-admin'));
const saPath = path.join(ROOT, 'service-account.json');
const sa = fs.existsSync(saPath) ? JSON.parse(fs.readFileSync(saPath, 'utf-8')) : null;
if (!sa && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Falta o arquivo service-account.json na pasta do sistema.');
  process.exit(1);
}
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || sa?.project_id, ...(sa ? { credential: admin.credential.cert(sa) } : {}) });

const user = await admin.auth().getUserByEmail(email);
await admin.firestore().collection('user_credentials').doc(user.uid).set(
  { totp: admin.firestore.FieldValue.delete(), totpPending: admin.firestore.FieldValue.delete() },
  { merge: true }
);
await admin.firestore().collection('users').doc(user.uid).set({ twoFactorEnabled: false }, { merge: true });
console.log(`Verificação em duas etapas DESATIVADA para ${email}. A senha continua a mesma.`);
process.exit(0);
