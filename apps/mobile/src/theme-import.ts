import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { THEME_IMPORT_LIMITS, type RawThemeImportFile } from '@mibbeacon/app';
import { VSCODE_THEME_MAX_BYTES } from '@mibbeacon/ui/vscode-theme';

export async function acquireNativeThemeFiles(): Promise<RawThemeImportFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: ['application/json', 'application/octet-stream', 'application/zip'],
  });
  if (result.canceled) return [];
  const files: RawThemeImportFile[] = [];
  for (const asset of result.assets) {
    const isVsix = asset.name.toLowerCase().endsWith('.vsix');
    const limit = isVsix ? THEME_IMPORT_LIMITS.maxArchiveBytes : VSCODE_THEME_MAX_BYTES;
    const info = asset.size == null ? await getInfoAsync(asset.uri) : undefined;
    const size = asset.size ?? (info?.exists ? info.size : undefined);
    if (size != null && size > limit) {
      throw new Error(`${asset.name} exceeds the ${limit}-byte safety limit.`);
    }
    const base64 = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    if (bytes.byteLength > limit) {
      throw new Error(`${asset.name} exceeds the ${limit}-byte safety limit.`);
    }
    files.push({
      name: asset.name,
      bytes,
    });
  }
  return files;
}
