import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { newRow } from './data';

export async function download(name: string, data: string, type: string) {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    const folder = `exports/${newRow().id}`;
    const { uri } = await Filesystem.writeFile({
      path: `${folder}/${name}`, data, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true,
    });
    try {
      await Share.share({ files: [uri] });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Share canceled') throw error;
    } finally {
      await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(() => {});
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
