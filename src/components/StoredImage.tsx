import React, { useEffect, useState } from 'react';
import { isStoredFile, resolveFileUrl } from '../lib/fileStore';

/** <img> que também exibe imagens guardadas no banco (endereço "fsfile://..."). */
export default function StoredImage({ src, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [resolved, setResolved] = useState<string | undefined>(isStoredFile(src) ? undefined : src);

  useEffect(() => {
    let alive = true;
    if (src && isStoredFile(src)) {
      resolveFileUrl(src).then(u => alive && setResolved(u)).catch(() => alive && setResolved(undefined));
    } else {
      setResolved(src);
    }
    return () => { alive = false; };
  }, [src]);

  if (!resolved) return <div className={rest.className} style={{ background: 'rgba(148,163,184,0.15)' }} />;
  return <img src={resolved} {...rest} />;
}
