# Code-OSS default color themes

These files are normalized JSON copies of the default color themes from
`microsoft/vscode` at revision:

`da20a6d0ddd819136575cd284741993a9e724c2f`

Upstream paths:

- `extensions/theme-defaults/package.json`
- `extensions/theme-defaults/themes/*.json`

The upstream Code-OSS license is included as `CODE-OSS-LICENSE.txt`.
The normalization removes JSON-with-comments syntax only; theme data is not
manually restyled.

Regenerate with:

```sh
pnpm --filter @mibbeacon/ui exec node ../../dev/sync-vscode-themes.mjs
```
