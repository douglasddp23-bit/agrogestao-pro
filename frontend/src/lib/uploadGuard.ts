// Conferência de arquivos ANTES de enviar (auditoria de segurança de 30/09/2026).
//
// A extensão do nome (".pdf", ".jpg") e o tipo informado pelo navegador podem ser
// falsificados — um arquivo "foto.jpg" pode ser, na verdade, uma página HTML com
// código malicioso. Aqui lemos os primeiros bytes do arquivo (a "assinatura" que
// todo formato tem) e só aceitamos formatos conhecidos e seguros, com tamanho
// máximo e nome limpo.

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'zip' | 'ole' | 'text';

export const IMAGE_KINDS: FileKind[] = ['png', 'jpeg', 'gif', 'webp'];
export const DOCUMENT_KINDS: FileKind[] = ['pdf', 'png', 'jpeg', 'gif', 'webp', 'zip', 'ole', 'text'];

/** Tipo (MIME) que o sistema grava para cada formato — nunca o informado pelo arquivo. */
const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  ole: 'application/octet-stream',
  text: 'text/plain',
};

/** Extensões aceitas para cada formato (a extensão precisa combinar com o conteúdo). */
const EXTENSIONS_BY_KIND: Record<FileKind, string[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg', 'jfif'],
  gif: ['gif'],
  webp: ['webp'],
  zip: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'zip', 'kmz'],
  ole: ['doc', 'xls', 'ppt'],
  text: ['txt', 'csv', 'kml', 'gpx', 'json'],
};

/** Tipos que o navegador pode abrir/exibir com segurança dentro do app. */
export const SAFE_INLINE_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'];

/** Tipos gravados pelo sistema (as regras do banco aceitam só estes). */
export const STORED_MIMES = Array.from(new Set([...Object.values(MIME_BY_KIND),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-earth.kmz', 'application/vnd.google-earth.kml+xml', 'text/csv',
  'application/msword', 'application/vnd.ms-excel',
]));

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  kmz: 'application/vnd.google-earth.kmz',
  kml: 'application/vnd.google-earth.kml+xml',
  csv: 'text/csv',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
};

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** Descobre o formato REAL pelo conteúdo (primeiros bytes). null = desconhecido/não aceito. */
export async function detectFileKind(file: Blob): Promise<FileKind | null> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';            // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'gif';                   // GIF8
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip';                   // docx/xlsx/kmz
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'; // doc/xls antigos
  // Texto puro: sem bytes nulos e sem marcação que o navegador executaria
  if (head.length > 0 && !head.includes(0)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head).toLowerCase();
    if (/<\s*(script|html|svg|iframe|object|embed|body|!doctype)/.test(text)) return null;
    return 'text';
  }
  return null;
}

/** Nome de arquivo limpo: sem pastas, sem caracteres especiais do Windows, até 120 caracteres. */
export function sanitizeFileName(name: string, fallback = 'arquivo'): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  let clean = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!clean) clean = fallback;
  if (clean.length > 120) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 8 ? clean.slice(dot) : '';
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  return clean;
}

const extensionOf = (name: string) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
};

const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

export interface CheckedUpload {
  kind: FileKind;
  mime: string;
  name: string;
}

/**
 * Confere o arquivo e devolve o formato real, o tipo a gravar e o nome limpo.
 * Lança UploadRejectedError (com mensagem para o usuário) se não for aceito.
 */
export async function checkUpload(
  file: Blob,
  originalName: string,
  opts: { allow: FileKind[]; maxBytes: number; label?: string },
): Promise<CheckedUpload> {
  const name = sanitizeFileName(originalName);
  if (!file || file.size === 0) throw new UploadRejectedError(`O arquivo "${name}" está vazio.`);
  if (file.size > opts.maxBytes) {
    throw new UploadRejectedError(`O arquivo "${name}" tem ${formatMB(file.size)} MB. O limite é ${formatMB(opts.maxBytes)} MB.`);
  }
  const kind = await detectFileKind(file);
  const what = opts.label || 'arquivo';
  if (!kind || !opts.allow.includes(kind)) {
    const onlyImages = opts.allow.every(k => IMAGE_KINDS.includes(k));
    throw new UploadRejectedError(onlyImages
      ? `"${name}" não é uma imagem válida (use JPG, PNG, GIF ou WebP).`
      : `"${name}" não é um ${what} aceito (use PDF, imagem, Word, Excel, KML/KMZ ou texto).`);
  }
  const ext = extensionOf(name);
  // A extensão precisa combinar com o conteúdo (ex.: HTML renomeado para .pdf é recusado)
  if (ext && !EXTENSIONS_BY_KIND[kind].includes(ext)) {
    throw new UploadRejectedError(`O conteúdo de "${name}" não corresponde à extensão .${ext}.`);
  }
  const finalName = ext ? name : `${name}.${EXTENSIONS_BY_KIND[kind][0]}`;
  const mime = MIME_BY_EXTENSION[ext] || MIME_BY_KIND[kind];
  return { kind, mime, name: finalName };
}

/** Atalho para campos que aceitam só imagem (foto de perfil, logo, fotos de visita). */
export function checkImageUpload(file: File, maxBytes = 8 * 1024 * 1024) {
  return checkUpload(file, file.name, { allow: IMAGE_KINDS, maxBytes, label: 'imagem' });
}
