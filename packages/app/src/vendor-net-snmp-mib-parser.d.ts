export interface ClientMibParser {
  ParseModule(name: string, content: string): void;
  Serialize(): void;
}
export declare const MIB: new (directory?: string) => ClientMibParser;
export default MIB;
