import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Quando a página é aberta pela Busca Global (topo da tela), já aplica o termo
 * buscado no campo de busca da própria página.
 */
export function useInitialSearch(setSearch: (term: string) => void) {
  const location = useLocation();
  const term = (location.state as { globalSearch?: string } | null)?.globalSearch;
  useEffect(() => {
    if (term) setSearch(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
}
