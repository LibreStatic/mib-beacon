import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, StorageAccessFramework, getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { pickNativeDirectory, pickNativeFiles, type AcquisitionResult } from '@mibbeacon/app';

const readBytes = async (uri: string) => {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

const uriName = (uri: string) => {
  const decoded = decodeURIComponent(uri);
  const slash = Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf(':'));
  return decoded.slice(slash + 1) || 'selected.mib';
};

/** Opens the native multi-document picker and eagerly reads selected bytes locally. */
export const acquireNativeMibFiles = (): Promise<AcquisitionResult> => pickNativeFiles({
  pick: async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ['text/plain', 'application/zip', 'application/octet-stream'],
    });
    return { canceled: result.canceled, assets: result.canceled ? [] : result.assets.map(({ name, uri, size }) => ({ name, uri, size })) };
  },
  readBytes,
});

/** Uses Android's Storage Access Framework; iOS returns the documented fallback result. */
export const acquireNativeMibDirectory = (): Promise<AcquisitionResult> => pickNativeDirectory(
  Platform.OS === 'android' ? 'android' : 'ios',
  {
    requestDirectory: async () => {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      return result.granted ? result.directoryUri : null;
    },
    list: async (uri) => Promise.all((await StorageAccessFramework.readDirectoryAsync(uri)).map(async (entryUri) => {
      const info = await getInfoAsync(entryUri);
      return { uri: entryUri, name: uriName(entryUri), directory: info.exists && info.isDirectory, size: info.exists && !info.isDirectory ? info.size : undefined };
    })),
    readBytes,
  },
);
