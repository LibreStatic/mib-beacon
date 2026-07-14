import type { MibNodeDetail, ModuleInfo } from '@mibbeacon/core/client';

export interface NodeMetadataRow {
  label: string;
  value: string;
}

export function nodeMetadataRows(node: MibNodeDetail): NodeMetadataRow[] {
  const implied = new Set(node.impliedIndexes ?? []);
  return [
    row('Named path', node.namedPath),
    row('Syntax', node.syntax),
    row('TC chain', node.textualConventionChain?.join(' → ')),
    row('Display hint', node.displayHint),
    row('Access', node.access),
    row('Status', node.status),
    row('Units', node.units),
    row(
      'Index',
      node.indexes?.map((index) => `${index}${implied.has(index) ? ' (IMPLIED)' : ''}`).join(', '),
    ),
    row('Augments', node.augments?.join(', ')),
    row('Objects', node.objects?.join(', ')),
    row(
      'Definitions',
      node.definitions?.map(({ module, name }) => `${module}::${name}`).join(', '),
    ),
    row('Warnings', node.warnings?.join('; ')),
  ].filter((item): item is NodeMetadataRow => item !== null);
}

export function moduleCatalogSummary(module: ModuleInfo): string | null {
  const parts = [
    module.revision || module.lastUpdated ? `rev ${module.revision ?? module.lastUpdated}` : null,
    module.organization ?? null,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function row(label: string, value?: string): NodeMetadataRow | null {
  return value ? { label, value } : null;
}
