import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';
import {
  IanaEnterpriseClient,
  OidBaseClient,
  OidRefClient,
  enterpriseNumberFromOid,
  parseIanaEnterpriseNumbers,
  parseOidBaseMarkdown,
  parseOidRefHtml,
} from './lookup';

const IANA_FIXTURE = `PRIVATE ENTERPRISE NUMBERS\n\n9\n  ciscoSystems\n    Thomas Sileo\n      tsileo&cisco.com\n11\n  Hewlett-Packard\n    Jane Doe\n      jane@example.test\n2636\n  Juniper Networks, Inc.\n`;

class StubHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: Record<string, HttpResponse>) {}
  async fetch(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[request.url];
    if (!response) throw new Error(`unexpected URL: ${request.url}`);
    return response;
  }
}

function response(text: string, status = 200): HttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: {}, text, bytes: text.length };
}

describe('IANA enterprise lookup', () => {
  it('parses enterprise number, organization, contact, and IANA-obfuscated email', () => {
    expect(parseIanaEnterpriseNumbers(IANA_FIXTURE)).toEqual([
      { number: 9, organization: 'ciscoSystems', contact: 'Thomas Sileo', email: 'tsileo@cisco.com' },
      { number: 11, organization: 'Hewlett-Packard', contact: 'Jane Doe', email: 'jane@example.test' },
      { number: 2636, organization: 'Juniper Networks, Inc.' },
    ]);
  });

  it('extracts an enterprise number only from the private-enterprise OID arc', () => {
    expect(enterpriseNumberFromOid('1.3.6.1.4.1.9.9.41')).toBe(9);
    expect(enterpriseNumberFromOid('.1.3.6.1.4.1.2636')).toBe(2636);
    expect(enterpriseNumberFromOid('1.3.6.1.2.1.1.1')).toBeNull();
    expect(enterpriseNumberFromOid('1.3.6.1.4.1.nope')).toBeNull();
  });

  it('fetches the registry through the injected HttpClient and finds the OID owner', async () => {
    const url = 'https://www.iana.org/assignments/enterprise-numbers.txt';
    const http = new StubHttpClient({ [url]: response(IANA_FIXTURE) });
    const result = await new IanaEnterpriseClient(http).lookupOid('1.3.6.1.4.1.9.1');

    expect(result?.organization).toBe('ciscoSystems');
    expect(http.requests).toEqual([{ url, method: 'GET', timeoutMs: 15_000, maxBytes: 5_000_000 }]);
  });
});

describe('OID Base lookup', () => {
  const markdown = `---\noid: 1.3.6.1.4.1.9\nasn1-notation: '{ iso(1) identified-organization(3) dod(6) internet(1) private(4) enterprise(1) 9 }'\ndescription: |\n  Cisco Systems enterprise tree.\n  Includes assigned child nodes.\nlast-modified: 2024-03-10\n---\n`;

  it('parses supported YAML frontmatter without a YAML runtime', () => {
    expect(parseOidBaseMarkdown(markdown)).toEqual({
      oid: '1.3.6.1.4.1.9',
      asn1Notation: '{ iso(1) identified-organization(3) dod(6) internet(1) private(4) enterprise(1) 9 }',
      description: 'Cisco Systems enterprise tree.\nIncludes assigned child nodes.',
      lastModified: '2024-03-10',
    });
  });

  it('uses the encoded numeric OID endpoint and returns null on an HTTP miss', async () => {
    const hitUrl = 'https://oid-base.com/get-md/1.3.6.1.4.1.9';
    const missUrl = 'https://oid-base.com/get-md/1.3.6.1.4.1.99999';
    const http = new StubHttpClient({ [hitUrl]: response(markdown), [missUrl]: response('not found', 404) });
    const client = new OidBaseClient(http);

    expect((await client.lookup('1.3.6.1.4.1.9'))?.description).toContain('Cisco Systems');
    expect(await client.lookup('1.3.6.1.4.1.99999')).toBeNull();
    expect(http.requests[0]).toEqual({ url: hitUrl, method: 'GET', timeoutMs: 15_000, maxBytes: 1_000_000 });
  });
});

describe('OIDRef lookup', () => {
  it('parses title and description regardless of meta attribute order and decodes entities', () => {
    const html = `<html><head><title>OID 1.3.6.1.4.1.9 &amp; children</title><meta content="Cisco &quot;private&quot; tree" name="description"></head></html>`;
    expect(parseOidRefHtml(html)).toEqual({
      title: 'OID 1.3.6.1.4.1.9 & children',
      description: 'Cisco "private" tree',
    });
  });

  it('fetches oidref through the injected HttpClient', async () => {
    const url = 'https://oidref.com/1.3.6.1.4.1.9';
    const http = new StubHttpClient({ [url]: response('<title>Cisco OID</title>') });
    const result = await new OidRefClient(http).lookup('1.3.6.1.4.1.9');

    expect(result).toEqual({ title: 'Cisco OID' });
    expect(http.requests[0]).toEqual({ url, method: 'GET', timeoutMs: 15_000, maxBytes: 1_000_000 });
  });
});
