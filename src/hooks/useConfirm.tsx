import React, { useCallback, useRef, useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

/**
 * Substitui o window.confirm() nativo pelo ConfirmationModal do sistema.
 * Uso: const [confirmAction, confirmModal] = useConfirm();
 *      if (!(await confirmAction({ title, description }))) return;
 *      ...e renderizar {confirmModal} em algum lugar do JSX.
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = (value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  };

  const confirmAction = useCallback((opts: ConfirmOptions) => {
    resolverRef.current?.(false);
    setOptions(opts);
    return new Promise<boolean>(resolve => { resolverRef.current = resolve; });
  }, []);

  const modal = (
    <ConfirmationModal
      isOpen={options !== null}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={options?.title || ''}
      description={options?.description || ''}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      variant={options?.variant}
    />
  );

  return [confirmAction, modal];
}
