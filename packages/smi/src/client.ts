/** Renderer-safe SMI helpers with no parser or net-snmp dependency. */
export { normalizeNumericOid } from './oid';
export {
  decodeTableIndex,
  type DecodedTableIndex,
  type DecodedTableIndexValue,
  type TableIndexDescriptor,
} from './table-info';
