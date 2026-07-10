/**
 * Ambient declarations for the subset of `net-snmp` (node-net-snmp, no bundled
 * types) that the engine uses. Verified against net-snmp@3.26.3 source.
 */
declare module 'net-snmp' {
  export const Version1: 0;
  export const Version2c: 1;
  export const Version3: 3;

  export const AuthProtocols: Record<string, number | string>;
  export const PrivProtocols: Record<string, number | string>;
  export const SecurityLevel: Record<string, number | string>;
  export const ObjectType: Record<string, number> & Record<number, string>;
  export const ErrorStatus: Record<string, number> & Record<number, string>;
  export const PduType: Record<string, number> & Record<number, string>;

  export interface Varbind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Pdu {
    type: number;
    varbinds: Varbind[];
    community?: string;
    contextEngineID?: string;
    contextName?: string;
    // v1 trap fields
    enterprise?: string;
    agentAddr?: string;
    generic?: number;
    specific?: number;
    upTime?: number;
  }

  export interface Notification {
    pdu: Pdu;
    rinfo: { address: string; port: number; family?: string };
  }

  export interface SessionOptions {
    port?: number;
    retries?: number;
    timeout?: number;
    transport?: 'udp4' | 'udp6';
    version?: number;
    idBitsSize?: number;
  }

  export interface V3User {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }

  export interface Session {
    get(oids: string[], cb: (error: Error | null, varbinds: Varbind[]) => void): void;
    getNext(oids: string[], cb: (error: Error | null, varbinds: Varbind[]) => void): void;
    set(varbinds: Varbind[], cb: (error: Error | null, varbinds: Varbind[]) => void): void;
    walk(
      oid: string,
      maxRepetitions: number,
      feedCb: (varbinds: Varbind[]) => void,
      doneCb: (error: Error | null) => void,
    ): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCb: (varbinds: Varbind[]) => void,
      doneCb: (error: Error | null) => void,
    ): void;
    trap(...args: unknown[]): void;
    close(): void;
    on(event: 'error' | 'close', listener: (err?: Error) => void): void;
  }

  export interface Authorizer {
    addCommunity(community: string): void;
    addUser(user: V3User): void;
  }

  export interface Receiver {
    getAuthorizer(): Authorizer;
    close(cb?: () => void): void;
  }

  // --- MIB module store (types verified against net-snmp@3.26.3 source) ---

  /** A parsed MIB symbol as stored in parser.Modules[module][symbol]. */
  export interface MibModuleEntry {
    ObjectName?: string;
    ModuleName?: string;
    MACRO?: string;
    SYNTAX?: string | Record<string, unknown>;
    'MAX-ACCESS'?: string;
    ACCESS?: string;
    STATUS?: string;
    DESCRIPTION?: string;
    INDEX?: string[];
    AUGMENTS?: string[];
    OBJECTS?: string[];
    'OBJECT IDENTIFIER'?: string;
    OID?: string;
    NameSpace?: string;
    [key: string]: unknown;
  }

  export interface MibParser {
    Modules: Record<string, Record<string, MibModuleEntry>>;
    ParseModule(fileName: string, contents: string): void;
    Serialize(): void;
  }

  export interface ModuleStore {
    parser: MibParser;
    loadFromFile(fileName: string): void;
    addTranslationsForModule(moduleName: string): void;
    getModule(moduleName: string): Record<string, MibModuleEntry> | undefined;
    getModules(includeBase?: boolean): Record<string, Record<string, MibModuleEntry>>;
    getModuleNames(includeBase?: boolean): string[];
    getProvidersForModule(moduleName: string): unknown[];
    translate(name: string, destinationFormat: string): string;
  }

  export function createModuleStore(options?: { baseModules?: string[] }): ModuleStore;

  export function createSession(target: string, community: string, options?: SessionOptions): Session;
  export function createV3Session(target: string, user: V3User, options?: SessionOptions): Session;
  export function createReceiver(
    options: {
      port?: number;
      transport?: 'udp4' | 'udp6';
      disableAuthorization?: boolean;
      includeAuthentication?: boolean;
      engineID?: string;
    },
    callback: (error: Error | null, notification: Notification) => void,
  ): Receiver;
  export function createAgent(...args: unknown[]): unknown;
  export function isVarbindError(varbind: Varbind): boolean;
  export function varbindError(varbind: Varbind): string;

  const snmp: {
    Version1: 0;
    Version2c: 1;
    Version3: 3;
    AuthProtocols: typeof AuthProtocols;
    PrivProtocols: typeof PrivProtocols;
    SecurityLevel: typeof SecurityLevel;
    ObjectType: typeof ObjectType;
    ErrorStatus: typeof ErrorStatus;
    PduType: typeof PduType;
    createSession: typeof createSession;
    createV3Session: typeof createV3Session;
    createReceiver: typeof createReceiver;
    createAgent: typeof createAgent;
    createModuleStore: typeof createModuleStore;
    isVarbindError: typeof isVarbindError;
    varbindError: typeof varbindError;
  };
  export default snmp;
}
