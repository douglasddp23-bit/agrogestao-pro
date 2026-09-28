// Armazenamento de arquivos GRATUITO dentro do próprio Firestore.
//
// O Firebase Storage exige o plano pago (Blaze). Para manter o sistema gratuito,
// cada arquivo (até 2 MB) é convertido em texto (base64) e dividido em pedaços
// que cabem no limite de 1 MB por documento do Firestore:
//   file_blobs/{id}                -> dados do arquivo (nome, tipo, tamanho, nº de pedaços)
//   file_blobs/{id}/chunks/{0..n}  -> pedaços do conteúdo
// O registro que usa o arquivo guarda url = "fsfile://{id}" e storagePath = "fsfile/{id}".
import { collection, doc, getDoc, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { toast } from 'sonner';
import { db, storage, auth } from './firebase';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHUNK_CHARS = 700_000;
const URL_PREFIX = 'fsfile://';
const PATH_PREFIX = 'fsfile/';

export class FileTooLargeError extends Error {
  constructor(name: string, size: number) {
    super(`O arquivo "${name}" tem ${(size / 1024 / 1024).toFixed(1).replace('.', ',')} MB. O limite é 2 MB por arquivo — reduza ou comprima antes de enviar.`);
    this.name = 'FileTooLargeError';
  }
}

/** Checagem antecipada (ao escolher o arquivo): fotos grandes passam, pois são reduzidas ao salvar. */
export const isTooLargeToSave = (file: Blob) =>
  file.size > MAX_FILE_BYTES && !/^image\/(jpeg|png|webp)$/.test(file.type);

export const isStoredFile =(url?: string) => !!url && url.startsWith(URL_PREFIX);

/** Mensagem amigável para qualquer erro de envio de arquivo. */
export function uploadErrorMessage(err: unknown): string {
  if (err instanceof FileTooLargeError) return err.message;
  const code = (err as any)?.code || '';
  if (code === 'permission-denied') return 'Você não tem permissão para enviar arquivos.';
  if (code === 'unavailable') return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return 'Não foi possível enviar o arquivo. Tente novamente.';
}

function readAsDataUrl(data: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(data);
  });
}

/**
 * Fotos (JPG/PNG/WebP) acima de ~1,5 MB são reduzidas para no máximo 1600 px (JPEG 80%),
 * o que deixa fotos de celular em ~300–600 KB. Outros tipos de arquivo não são alterados.
 */
async function shrinkPhotoIfNeeded(data: Blob): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(data.type) || data.size <= 1.5 * 1024 * 1024) return data;
  try {
    const bitmap = await createImageBitmap(data);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8));
    return out && out.size < data.size ? out : data;
  } catch {
    return data;
  }
}

/** Salva o arquivo e devolve { url, storagePath } para gravar no registro que o usa. */
export async function saveFile(original: Blob, name: string, extra: { clientId?: string } = {}) {
  const data = await shrinkPhotoIfNeeded(original);
  if (data.size > MAX_FILE_BYTES) throw new FileTooLargeError(name, data.size);

  const dataUrl = await readAsDataUrl(data);
  const parts: string[] = [];
  for (let i = 0; i < dataUrl.length; i += CHUNK_CHARS) parts.push(dataUrl.slice(i, i + CHUNK_CHARS));

  const metaRef = doc(collection(db, 'file_blobs'));
  const batch = writeBatch(db);
  batch.set(metaRef, {
    name,
    type: data.type || 'application/octet-stream',
    size: data.size,
    chunks: parts.length,
    clientId: extra.clientId || '',
    createdBy: auth.currentUser?.uid || '',
    createdAt: new Date().toISOString(),
  });
  parts.forEach((part, i) => batch.set(doc(db, 'file_blobs', metaRef.id, 'chunks', String(i)), { index: i, data: part }));
  await batch.commit();

  return { url: URL_PREFIX + metaRef.id, storagePath: PATH_PREFIX + metaRef.id };
}

const blobUrlCache = new Map<string, string>();

/** Converte "fsfile://id" em um endereço que o navegador consegue abrir/exibir. Outros endereços voltam iguais. */
export async function resolveFileUrl(url: string): Promise<string> {
  if (!isStoredFile(url)) return url;
  const cached = blobUrlCache.get(url);
  if (cached) return cached;

  const id = url.slice(URL_PREFIX.length);
  const meta = await getDoc(doc(db, 'file_blobs', id));
  if (!meta.exists()) throw new Error('Arquivo não encontrado (pode ter sido excluído).');
  const snap = await getDocs(collection(db, 'file_blobs', id, 'chunks'));
  const dataUrl = snap.docs
    .map(d => d.data() as { index: number; data: string })
    .sort((a, b) => a.index - b.index)
    .map(c => c.data)
    .join('');
  const blob = await (await fetch(dataUrl)).blob();
  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(url, objectUrl);
  return objectUrl;
}

/** Abre o arquivo numa nova janela (PDF/imagem) ou baixa, conforme o tipo. */
export async function openStoredFile(url: string, name = 'arquivo') {
  const target = await resolveFileUrl(url);
  const a = document.createElement('a');
  a.href = target;
  a.target = '_blank';
  a.rel = 'noopener';
  if (!/\.(pdf|png|jpe?g|webp|gif|txt)$/i.test(name)) a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Para usar em <a href={url} onClick={(e) => handleFileLinkClick(e, url, nome)}>:
 * links antigos (Storage/https) seguem normais; "fsfile://" é resolvido e aberto.
 */
export function handleFileLinkClick(e: { preventDefault: () => void }, url: string, name?: string) {
  if (!isStoredFile(url)) return;
  e.preventDefault();
  openStoredFile(url, name).catch(err => {
    console.error('Erro ao abrir arquivo:', err);
    toast.error(err?.message || 'Não foi possível abrir o arquivo.');
  });
}

/** Apaga o arquivo (novo formato no Firestore ou antigo no Storage). Não lança erro se já não existir. */
export async function deleteStoredFile(storagePath?: string) {
  if (!storagePath) return;
  if (storagePath.startsWith(PATH_PREFIX)) {
    const id = storagePath.slice(PATH_PREFIX.length);
    const chunks = await getDocs(collection(db, 'file_blobs', id, 'chunks'));
    const batch = writeBatch(db);
    chunks.docs.forEach(c => batch.delete(c.ref));
    await batch.commit();
    await deleteDoc(doc(db, 'file_blobs', id));
    blobUrlCache.delete(URL_PREFIX + id);
    return;
  }
  await deleteObject(ref(storage, storagePath)).catch(err => console.warn('Arquivo antigo não encontrado no Storage:', err));
}
