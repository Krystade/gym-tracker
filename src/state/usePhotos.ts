import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import type { PhotoMeta } from '../domain/photos';

export function usePhotos() {
  const db = useDb();
  const [metas, setMetas] = useState<PhotoMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every write so image views re-read a retaken photo under the same id.
  const [version, setVersion] = useState(0);
  useEffect(() => { void db.getPhotoMetas().then(setMetas).catch((e) => setError(`Could not load photos: ${String(e)}`)); }, []);
  const add = useCallback(async (meta: PhotoMeta, full: Blob, thumb: Blob): Promise<boolean> => {
    try { await db.putPhoto(meta, full, thumb); setMetas((xs) => [...xs.filter((x) => x.id !== meta.id), meta]); setVersion((v) => v + 1); setError(null); return true; }
    catch (e) { setError(`Saving the photo failed: ${String(e)}`); return false; }
  }, []);
  const remove = useCallback(async (id: string): Promise<boolean> => {
    try { await db.deletePhoto(id); setMetas((xs) => xs.filter((x) => x.id !== id)); setVersion((v) => v + 1); setError(null); return true; }
    catch (e) { setError(`Deleting the photo failed: ${String(e)}`); return false; }
  }, []);
  return { metas, error, version, add, remove };
}
export type PhotosStore = ReturnType<typeof usePhotos>;
