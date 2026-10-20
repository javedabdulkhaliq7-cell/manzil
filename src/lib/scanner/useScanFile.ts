// IQRA Scanner — turns a private-folder path into an <img>-usable URL.
// Put at src/lib/scanner/useScanFile.ts
import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'

// `version` (e.g. the scan's updatedAt) busts the WebView cache when a file is rewritten under the same name.
export function useScanFile(path: string | null, version?: number): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!path) { setSrc(null); return }
    Filesystem.getUri({ path, directory: Directory.Data })
      .then(({ uri }) => { if (alive) setSrc(Capacitor.convertFileSrc(uri) + (version ? `?v=${version}` : '')) })
      .catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [path, version])
  return src
}
