# FTP resolver fixture

This local-only vsftpd fixture exposes the same read-only MIB directory through
anonymous login and through `mibtest` / `mibtest`. It uses passive ports
21100-21110 and maps the control port to localhost 2121.

```bash
docker compose -f dev/ftp-fixture/docker-compose.yml up -d --build
MIBBEACON_FTP_FIXTURE=1 pnpm exec vitest run packages/resolver/src/ftp.docker.integration.test.ts
docker compose -f dev/ftp-fixture/docker-compose.yml down
```

The opt-in integration test exercises both authentication modes through the
same production `PassiveFtpClient` used by desktop. Android uses the same FTP
protocol implementation over the React Native TCP adapter; on-device release
evidence remains a separate checklist item.
