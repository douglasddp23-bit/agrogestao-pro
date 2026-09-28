// Proteção contra duplo clique / duplo envio de formulários.
// Enquanto uma ação identificada por `key` está em andamento, novas chamadas
// com a mesma chave são ignoradas (evita cadastro, cobrança ou folha em dobro).
const inFlight = new Set<string>();

export async function runExclusive<T>(key: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  if (inFlight.has(key)) return undefined;
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}
