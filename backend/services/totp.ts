// Verificação em duas etapas (2FA) por aplicativo autenticador
// (Google Authenticator, Microsoft Authenticator, Authy...).
//
// Em português simples: na ativação, o servidor gera um "segredo" e mostra
// como QR Code. O aplicativo do celular guarda esse segredo e, a cada 30
// segundos, calcula um código de 6 dígitos a partir dele e do relógio. No
// login, o servidor faz a mesma conta e confere se o código bate.
// Padrão aberto TOTP (RFC 6238) — funciona sem internet no celular, sem SMS
// e sem custo nenhum no Firebase.
import crypto from 'crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo de 160 bits (tamanho recomendado para HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/** Código válido agora (usado só nos testes automáticos). */
export function totpNow(secret: string, now = Date.now()): string {
  return hotp(base32Decode(secret), currentStep(now));
}

/**
 * Confere o código aceitando 1 passo de diferença para cada lado (±30 s),
 * para tolerar relógio do celular levemente adiantado/atrasado.
 * Devolve o "passo" que bateu (para impedir reutilizar o mesmo código) ou null.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep?: number | null, now = Date.now()): number | null {
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length !== DIGITS) return null;
  const key = base32Decode(secret);
  const step = currentStep(now);
  for (const delta of [0, -1, 1]) {
    const s = step + delta;
    if (lastUsedStep != null && s <= lastUsedStep) continue; // código já usado
    const expected = hotp(key, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, accountName: string, issuer = 'AgroGestão Pro'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Códigos de recuperação (uso único) para quando o celular for perdido. */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não confundir
  return Array.from({ length: count }, () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
