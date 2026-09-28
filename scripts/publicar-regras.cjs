// Publica as regras de segurança do banco (Firestore) no projeto REAL.
//
// Uso (na pasta agrogestao-pro):
//   node scripts\publicar-regras.cjs                  → publica o arquivo firestore.rules
//   node scripts\publicar-regras.cjs ARQUIVO.rules    → publica outro arquivo (ex.: voltar à versão anterior)
//
// Antes de publicar, guarda a versão que está no ar em
// firestore-regras-NO-AR-<data-hora>.rules (para poder voltar atrás).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const admin = require(path.join(ROOT, 'node_modules', 'firebase-admin'));
const sa = require(path.join(ROOT, 'service-account.json'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });

(async () => {
  const file = path.resolve(ROOT, process.argv[2] || 'firestore.rules');
  const newSrc = fs.readFileSync(file, 'utf-8').replace(/^﻿/, '');
  const rules = admin.securityRules();

  const current = await rules.getFirestoreRuleset();
  const currentSrc = current.source[0].content;
  if (currentSrc === newSrc) {
    console.log('Nada a fazer: essas regras já estão publicadas.');
    process.exit(0);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const backup = path.join(ROOT, `firestore-regras-NO-AR-${stamp}.rules`);
  fs.writeFileSync(backup, currentSrc);
  console.log('1/3 Versão que estava no ar guardada em:', path.basename(backup));

  const created = await rules.createRuleset(rules.createRulesFileFromSource('firestore.rules', newSrc));
  console.log('2/3 Regras conferidas e aceitas pelo Google.');
  await rules.releaseFirestoreRuleset(created);

  const after = await rules.getFirestoreRuleset();
  const ok = after.source[0].content === newSrc;
  console.log(ok ? '3/3 PUBLICADO com sucesso.' : '3/3 ATENÇÃO: a versão no ar não confere com o arquivo.');
  console.log(`Para desfazer: node scripts\\publicar-regras.cjs ${path.basename(backup)}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERRO — nada foi alterado:', e.message); process.exit(1); });
