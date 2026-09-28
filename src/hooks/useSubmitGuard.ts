import { useCallback, useRef, useState } from 'react';

/**
 * Impede duplo clique / duplo envio: enquanto uma gravação está em andamento,
 * novas chamadas são ignoradas. Uso:
 *   const [isSubmitting, guard] = useSubmitGuard();
 *   <button disabled={isSubmitting} onClick={() => guard(handleSave)}>
 */
export function useSubmitGuard(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const busyRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const guard = useCallback(async <T,>(fn: () => Promise<T>) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setIsSubmitting(true);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return [isSubmitting, guard];
}
