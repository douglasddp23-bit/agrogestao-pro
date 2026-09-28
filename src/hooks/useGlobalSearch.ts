import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';

export type SearchResult = {
  id: string;
  type: 'client' | 'service';
  title: string;
  subtitle: string;
  page: string;
};

export function useGlobalSearch(searchTerm: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchTerm.length < 2) {
      setResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      setLoading(true);
      const term = searchTerm.toLowerCase();
      try {
        const searchResults: SearchResult[] = [];
        
        // Search Clients using nameLower for scalability
        const qClients = query(
          collection(db, 'clients'),
          where('nameLower', '>=', term),
          where('nameLower', '<=', term + '\uf8ff'),
          limit(10)
        );
        const snapClients = await getDocs(qClients);
        snapClients.docs.forEach(doc => {
          const data = doc.data();
          searchResults.push({
            id: doc.id,
            type: 'client',
            title: data.name,
            subtitle: 'Produtor / Cliente',
            page: 'clients'
          });
        });

        setResults(searchResults);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  return { results, loading };
}
