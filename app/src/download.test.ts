import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { afterEach, expect, it, vi } from 'vitest';
import { download } from './download';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn(), rmdir: vi.fn() },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

it.each([
  ['workspace.json', '{"company":"Northwind"}', 'application/json'],
  ['contacts.csv', 'Name\r\nContoso', 'text/csv'],
])('exports %s as a UTF-8 file to the native iOS share sheet', async (name, data, type) => {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
  const write = vi.spyOn(Filesystem, 'writeFile').mockResolvedValue({ uri: `file:///cache/${name}` });
  const share = vi.spyOn(Share, 'share').mockResolvedValue({});
  const remove = vi.spyOn(Filesystem, 'rmdir').mockResolvedValue(undefined);
  await download(name, data, type);
  expect(write).toHaveBeenCalledWith({ path: expect.stringMatching(new RegExp(`^exports/[^/]+/${name}$`)), data, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  expect(share).toHaveBeenCalledWith({ files: [`file:///cache/${name}`] });
  expect(remove).toHaveBeenCalledWith({ path: write.mock.calls[0][0].path.split('/').slice(0, -1).join('/'), directory: Directory.Cache, recursive: true });
});
