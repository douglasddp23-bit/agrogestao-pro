import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

// Proteções gerais do servidor (auditoria de segurança de 30/09/2026).
// O servidor roda dentro de cada computador (Electron, só em 127.0.0.1), mas
// qualquer site aberto no navegador desse PC consegue tentar mandar pedidos
// para http://localhost:3000. Estas camadas impedem isso.

/** Origens (sites) que podem chamar a API: só o próprio app. */
export function buildAllowedOrigins(port: number): string[] {
  const extra = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(s => /^https?:\/\/[^\s/]+$/.test(s));
  return [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(process.env.APP_URL && /^https?:\/\//.test(process.env.APP_URL) ? [process.env.APP_URL.replace(/\/+$/, '')] : []),
    ...extra,
  ];
}

/**
 * Anti "DNS rebinding": um site malicioso pode fazer o próprio endereço
 * (ex.: ataque.com) apontar para 127.0.0.1 e, assim, falar com este servidor
 * como se fosse "o mesmo site". O navegador manda o nome original no
 * cabeçalho Host — aceitamos só os nomes do próprio app.
 */
export function hostGuard(allowedOrigins: string[]) {
  const allowedHosts = new Set(allowedOrigins.map(o => o.replace(/^https?:\/\//, '').toLowerCase()));
  return (req: Request, res: Response, next: NextFunction) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (allowedHosts.has(host)) return next();
    res.status(421).json({ error: 'Endereço não permitido.' });
  };
}

/**
 * Anti-CSRF: pedidos que ALTERAM dados (POST/PUT/PATCH/DELETE) só são aceitos
 * vindos do próprio app. O navegador sempre manda "Origin" nesses pedidos e
 * um site não consegue falsificá-lo. Pedidos sem Origin vêm de programas
 * locais (não de um navegador) — esses não carregam a sessão de ninguém.
 */
export function originGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      return res.status(403).json({ error: 'Pedido recusado: origem não autorizada.' });
    }
    const secFetchSite = String(req.headers['sec-fetch-site'] || '');
    if (secFetchSite === 'cross-site') {
      return res.status(403).json({ error: 'Pedido recusado: origem não autorizada.' });
    }
    // Só JSON: formulários HTML de outros sites (text/plain, form-urlencoded) ficam de fora
    const type = String(req.headers['content-type'] || '');
    if (type && !type.toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'Formato de dados não suportado.' });
    }
    next();
  };
}

/**
 * Limite de pedidos POR USUÁRIO logado (usar depois de requireAuth/requireAdmin).
 * Sem usuário identificado, conta pelo IP.
 */
export function userLimiter(opts: { windowMs: number; max: number; message: string }) {
  const options: Partial<Options> = {
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req: any) => (req.user?.uid ? `u:${req.user.uid}` : `ip:${req.ip}`),
    message: { error: opts.message },
  };
  return rateLimit(options);
}

/** Texto do usuário com tamanho máximo (para prompts de IA, e-mails etc.). */
export function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * Arquivos da pasta dist/ que NUNCA podem ser servidos: o próprio servidor
 * (server.cjs) e os mapas de código-fonte (*.map), que revelariam o código
 * do servidor e caminhos internos.
 */
export function blockPrivateBuildFiles(req: Request, res: Response, next: NextFunction) {
  const p = decodeURIComponent(req.path || '').toLowerCase();
  if (/(^|\/)server\.cjs/.test(p) || p.endsWith('.map') || /(^|\/)\./.test(p)) {
    return res.status(404).send('Não encontrado.');
  }
  next();
}

/**
 * Último tratador de erros: o usuário recebe só uma mensagem genérica; o
 * detalhe técnico (pilha, caminho de arquivo) fica apenas no registro do servidor.
 */
export const genericErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) {
    console.error(`[Erro] ${req.method} ${req.path}:`, err?.message || err);
  }
  if (res.headersSent) return;
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dados enviados grandes demais.' });
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'Pedido inválido.' });
  }
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
};
