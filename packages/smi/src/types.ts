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
  units?: string;
  description?: string;
  /** INDEX clause column names for entry rows. */
  indexes?: string[];
  /** INDEX members marked IMPLIED for variable-length instance decoding. */
  impliedIndexes?: string[];
  /** Base entry named by an AUGMENTS clause. */
  augments?: string[];
  /** Resolved textual convention names followed by the primitive syntax. */
  textualConventionChain?: string[];
  /** RFC 2579 DISPLAY-HINT inherited from the resolved textual convention. */
  displayHint?: string;
  /** Enumeration labels retained from INTEGER/BITS syntax. */
  enumValues?: Record<string, number>;
  /** Machine-readable numeric ranges retained from the resolved SYNTAX. */
  numericRanges?: { min: number; max: number }[];
  /** Machine-readable SIZE ranges retained from the resolved SYNTAX. */
  sizeRanges?: { min: number; max: number }[];
  /** Every module definition retained when vendors assign the same numeric OID. */
  definitions?: { module: string; name: string }[];
  /** Non-fatal metadata conflicts relevant to display/decoding. */
  warnings?: string[];
  /** OBJECTS clause of a NOTIFICATION-TYPE. */
  objects?: string[];
}

export interface ModuleInfo {
  name: string;
  objectCount: number;
  isBase: boolean;
  lastUpdated?: string;
  revision?: string;
  organization?: string;
}

export interface ModuleDependency {
  name: string;
  symbols: string[];
  loaded: boolean;
}

export interface ModuleView {
  module: ModuleInfo;
  dependencies: ModuleDependency[];
}

export type ModuleTreeRole = 'module' | 'dependency' | 'parent';

export interface ModuleTreeNode extends MibNodeSummary {
  role: ModuleTreeRole;
}

export interface ImportResult {
  loaded: string[];
  errors: {
    name: string;
    message: string;
    code?: 'MIB_MISSING_IMPORTS' | 'MIB_PARSE_FAILED';
    missingImports?: { module: string; symbols: string[] }[];
  }[];
}

export interface MibTextFile {
  name: string;
  content: string;
  relativePath?: string;
}

export interface MibFileImportInspection {
  module: string;
  symbols: string[];
  external: boolean;
}

export type MibModuleCollisionKind = 'base' | 'loaded-user' | 'batch-duplicate';

export interface MibFileInspection {
  name: string;
  relativePath?: string;
  modules: string[];
  imports: MibFileImportInspection[];
  warnings: string[];
  errors: string[];
  collisions: { module: string; kind: MibModuleCollisionKind; replacementGroup?: string[] }[];
}

export interface MibFilesInspection {
  files: MibFileInspection[];
  duplicateDefinitions: { module: string; files: string[] }[];
  externalMissingImports: { module: string; symbols: string[]; requestedBy: string[] }[];
  replacementGroups: { modules: string[] }[];
}

export interface MibSearchHit {
  oid: string;
  name: string;
  module?: string;
  kind: MibNodeKind;
  /** which field matched */
  matched: 'name' | 'oid' | 'description';
  highlights?: { field: 'name' | 'oid' | 'description'; start: number; end: number }[];
}

export interface ResolvedName {
  /** e.g. ifOperStatus.3 (definition name + instance suffix) */
  name: string;
  module?: string;
  /** OID of the matched definition (prefix of the input). */
  definitionOid: string;
}

export interface OidTranslation {
  oid: string;
  name: string;
  module?: string;
}
