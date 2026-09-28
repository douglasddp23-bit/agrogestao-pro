// Ferramenta de linha de comando para o DONO/VENDEDOR do AgroGestão Pro
// cadastrar o administrador principal de uma instalação nova — sem depender
// de login com Google e sem precisar que o cliente configure nada.
//
// Uso: node scripts/criar-administrador.mjs
// (ou dando duplo clique em 0-criar-administrador.bat)
//
// Precisa de um arquivo service-account.json na raiz do projeto — veja o
// arquivo COMO-GERAR-O-INSTALAVEL.md para o passo a passo de como baixar
// esse arquivo no Firebase Console.

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const serviceAccountPath = path.join(projectRoot, 'service-account.json');

function fail(message) {
  console.error('\n❌ ' + message + '\n');
  process.exit(1);
}

if (!existsSync(serviceAccountPath)) {
  fail(
    'Não encontrei o arquivo "service-account.json" na pasta do projeto.\n' +
    '   Baixe esse arquivo no Firebase Console (Configurações do projeto → Contas de\n' +
    '   serviço → Gerar nova chave privada) e coloque-o na mesma pasta do projeto,\n' +
    '   com esse nome exato, antes de rodar este script de novo.'
  );
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
} catch (err) {
  fail('O arquivo service-account.json não é um JSON válido: ' + err.message);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (err) {
  fail(
    'O arquivo service-account.json parece estar corrompido ou incompleto.\n' +
    '   Baixe um novo (Firebase Console → Configurações do projeto → Contas de\n' +
    '   serviço → Gerar nova chave privada) e tente de novo.\n' +
    '   Detalhe técnico: ' + (err.message || err)
  );
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (question) => (await rl.question(question)).trim();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  console.log('\n=== Cadastro do Administrador Principal — AgroGestão Pro ===');
  console.log(`Projeto Firebase: ${serviceAccount.project_id}\n`);

  const displayName = await ask('Nome completo do administrador: ');
  if (!displayName) fail('O nome não pode ficar em branco.');

  let email = await ask('E-mail de acesso (login): ');
  if (!isValidEmail(email)) fail('E-mail inválido.');
  email = email.toLowerCase().trim();

  let password = await ask('Senha (mínimo 8 caracteres): ');
  while (password.length < 8) {
    password = await ask('Senha muito curta. Digite uma senha com pelo menos 8 caracteres: ');
  }

  rl.close();

  console.log('\nCriando conta...');

  let uid;
  try {
    const existing = await admin.auth().getUserByEmail(email).catch(() => null);
    if (existing) {
      uid = existing.uid;
      await admin.auth().updateUser(uid, { password, displayName, emailVerified: true });
      console.log('Já existia uma conta com esse e-mail — a senha e o nome foram atualizados.');
    } else {
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName,
        emailVerified: true,
      });
      uid = userRecord.uid;
    }

    await admin.auth().setCustomUserClaims(uid, { role: 'admin' });

    // O documento em users/{uid} guarda o perfil (nome, cargo, etc). A
    // senha em si NÃO fica aqui — o Firebase Authentication já cuida dela
    // com segurança, então este documento não precisa (e não deve) ter
    // nenhum campo de senha.
    await admin.firestore().collection('users').doc(uid).set(
      {
        uid,
        displayName,
        email,
        role: 'admin',
        registrationNumber: 'ADM-001',
        department: 'Diretoria Executiva',
        status: 'offline',
        mustChangePassword: false,
        blocked: false,
        isVirtual: false,
        createdBy: 'setup_script',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log('\n✅ Administrador cadastrado com sucesso!');
    console.log(`   E-mail: ${email}`);
    console.log('   Senha: (a que você digitou)');
    console.log('\nJá pode abrir o AgroGestão Pro e entrar com esse e-mail e senha.\n');
  } catch (err) {
    fail('Falha ao criar o administrador: ' + (err.message || err));
  }
}

main();
