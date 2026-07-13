import type { HttpClient } from '@mibbeacon/transport';
import { GitHubTreeSource } from './github-tree';
import { HttpTemplateSource } from './http-template';
import type { MibSource, SecretResolver, SourceConfig } from './types';

export const BUILTIN_SOURCE_CONFIGS = [
  { id: 'cache', kind: 'cache', name: 'Local cache', enabled: true, priority: 0, builtIn: true },
  {
    id: 'pysnmp',
    kind: 'http-template',
    name: 'pysnmp corpus',
    enabled: true,
    priority: 1,
    builtIn: true,
    urlTemplate: 'https://mibs.pysnmp.com/asn1/@mib@',
    authKind: 'none',
  },
  {
    id: 'pysnmp-github',
    kind: 'http-template',
    name: 'pysnmp GitHub mirror',
    enabled: true,
    priority: 2,
    builtIn: true,
    urlTemplate: 'https://raw.githubusercontent.com/lextudio/mibs.pysnmp.com/master/asn1/@mib@',
    authKind: 'none',
  },
  {
    id: 'librenms',
    kind: 'github-tree',
    name: 'LibreNMS collection',
    enabled: true,
    priority: 3,
    builtIn: true,
    owner: 'librenms',
    repo: 'librenms',
    branch: 'master',
    pathPrefix: 'mibs/',
  },
  {
    id: 'cisco',
    kind: 'http-template',
    name: 'Cisco official',
    enabled: true,
    priority: 4,
    builtIn: true,
    urlTemplate: 'https://raw.githubusercontent.com/cisco/cisco-mibs/main/v2/@mib@',
    fixedExtension: '.my',
    modulePattern: '^CISCO',
    authKind: 'none',
  },
  {
    id: 'netdisco',
    kind: 'github-tree',
    name: 'netdisco-mibs',
    enabled: true,
    priority: 5,
    builtIn: true,
    owner: 'netdisco',
    repo: 'netdisco-mibs',
    branch: 'master',
    pathPrefix: '',
  },
  {
    id: 'mibbrowser-online',
    kind: 'http-template',
    name: 'mibbrowser.online',
    enabled: true,
    priority: 6,
    builtIn: true,
    urlTemplate: 'https://mibbrowser.online/mibs/@mib@',
    fixedExtension: '.mib',
    authKind: 'none',
  },
  {
    id: 'circitor',
    kind: 'http-template',
    name: 'Circitor',
    enabled: false,
    priority: 7,
    builtIn: true,
    urlTemplate: 'https://circitor.fr/Mibs/Mib/@first@/@mib@',
    fixedExtension: '.mib',
    authKind: 'none',
  },
] as const satisfies readonly SourceConfig[];


export function createBuiltinSources(http: HttpClient, resolveSecret?: SecretResolver): MibSource[] {
  const sources: MibSource[] = [];
  for (const config of BUILTIN_SOURCE_CONFIGS) {
    if (config.kind === 'http-template') sources.push(new HttpTemplateSource(config, http, resolveSecret));
    if (config.kind === 'github-tree') sources.push(new GitHubTreeSource(config, http, resolveSecret));
  }
  return sources;
}
