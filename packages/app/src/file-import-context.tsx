import { createContext, useContext, type ReactNode } from 'react';
import {
  collectWebDataTransfer,
  pickWebDirectory,
  pickWebFiles,
  type AcquisitionResult,
} from './file-import';

export interface FileImportAdapter {
  platform: 'web' | 'desktop' | 'android' | 'ios';
  acquireFiles(): Promise<AcquisitionResult>;
  acquireDirectory(): Promise<AcquisitionResult>;
  acquireDrop?(dataTransfer: DataTransfer): Promise<AcquisitionResult>;
  destinationLabel?: string;
}

const browserDestination = () => {
  if (typeof window === 'undefined') return 'Connected engine';
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return `LAN server at ${window.location.host}`;
  }
  return 'Desktop engine on this computer';
};

const webAdapter: FileImportAdapter = {
  platform: 'web',
  acquireFiles: () => pickWebFiles(),
  acquireDirectory: () => pickWebDirectory(),
  acquireDrop: (dataTransfer) => collectWebDataTransfer(dataTransfer),
  get destinationLabel() { return browserDestination(); },
};

const FileImportContext = createContext<FileImportAdapter>(webAdapter);

export function FileImportProvider({ adapter, children }: { adapter: FileImportAdapter; children: ReactNode }) {
  return <FileImportContext.Provider value={adapter}>{children}</FileImportContext.Provider>;
}

export const useFileImportAdapter = () => useContext(FileImportContext);
