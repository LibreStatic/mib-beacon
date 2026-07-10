/** Kind of a node in the OID tree, derived from its MACRO/syntax/position. */
export type MibNodeKind =
  | 'module-identity'
  | 'subtree' // internal node / OBJECT IDENTIFIER assignment
  | 'table'
  | 'entry'
  | 'column'
  | 'scalar'
  | 'notification'
  | 'unknown'; // numeric arc with no loaded definition

export interface MibNodeSummary {
  oid: string;
  /** Last path label (symbol name, or the numeric arc when undefined). */
  name: string;
  module?: string;
  kind: MibNodeKind;
  access?: string;
  hasChildren: boolean;
  childCount: number;
}

export interface MibNodeDetail extends MibNodeSummary {
  /** Fully-qualified named path, e.g. iso.org.dod.internet.mgmt.mib-2.system.sysDescr */
  namedPath?: string;
  syntax?: string;
  status?: string;
  description?: string;
  /** INDEX clause column names for entry rows. */
  indexes?: string[];
  /** OBJECTS clause of a NOTIFICATION-TYPE. */
  objects?: string[];
}

export interface ModuleInfo {
  name: string;
  objectCount: number;
  isBase: boolean;
}

export interface ImportResult {
  loaded: string[];
  errors: { name: string; message: string }[];
}

export interface MibSearchHit {
  oid: string;
  name: string;
  module?: string;
  kind: MibNodeKind;
  /** which field matched */
  matched: 'name' | 'oid' | 'description';
}

export interface ResolvedName {
  /** e.g. ifOperStatus.3 (definition name + instance suffix) */
  name: string;
  module?: string;
  /** OID of the matched definition (prefix of the input). */
  definitionOid: string;
}
