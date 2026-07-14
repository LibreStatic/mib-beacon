# Custom MIB source examples

External resolution is disabled on a fresh install. Enable the resolver and
approve the disclosure prompt before testing a source. Imported definitions are
untrusted input: review diagnostics and source attribution before using them for
Set operations.

## HTTP template

Use `@mib@` where the requested module name belongs:

```text
https://example.net/mibs/@mib@.mib
```

Alternatively configure a base URL and a fixed extension; the resolver tries
bounded filename variants. Basic-auth passwords and secret headers remain in
the engine's encrypted secret store and are omitted from exports.

## JSON catalog and JSONPath

For this catalog:

```json
{
  "modules": [
    { "name": "IF-MIB", "download": "https://example.net/mibs/IF-MIB.txt" },
    { "name": "SNMPv2-MIB", "download": "https://example.net/mibs/SNMPv2-MIB.txt" }
  ]
}
```

configure:

```text
Name JSONPath: $.modules[*].name
URL JSONPath:  $.modules[*].download
```

Preview fetches the live catalog and shows at most the first 4 KiB of raw JSON.
A name path is optional when module names can be derived safely from URLs.

## FTP / explicit FTPS

Example anonymous FTP source:

```text
Host: ftp.example.net
Port: 21
Mode: FTP
Anonymous: yes
Path template: /pub/mibs/@mib@
Fixed extension: .mib
```

Passive mode is used. Explicit FTPS verifies the certificate and hostname on a
Node/Electron engine host; it is intentionally unavailable in the mobile
in-process engine. Credentials are never written to exported source JSON.

## GitHub tree

Provide owner, repository, branch, and an optional path prefix. A token is
optional for public repositories and is stored by reference when supplied.
The implementation uses the GitHub tree API rather than scraping HTML.
