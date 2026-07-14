import { describe, expect, it } from 'vitest';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { FtpSource, PassiveFtpClient } from './ftp';
import type { FtpSourceConfig } from './sources/types';

const enabled = process.env['MIBBEACON_FTP_FIXTURE'] === '1';
const base: FtpSourceConfig = {
  id: 'docker-ftp',
  kind: 'ftp',
  name: 'Local vsftpd fixture',
  enabled: true,
  priority: 0,
  host: '127.0.0.1',
  port: 2121,
  secure: 'none',
  anonymous: true,
  pathTemplate: '/@mib@',
  fixedExtension: '.mib',
};

describe.runIf(enabled)('vsftpd resolver fixture', () => {
  const client = new PassiveFtpClient(createNodeTransport().tcp);

  it('retrieves and validates a module anonymously', async () => {
    await expect(new FtpSource(base, client).fetch('FIXTURE-MIB')).resolves.toMatchObject({
      status: 'found',
      moduleName: 'FIXTURE-MIB',
    });
  });

  it('retrieves and validates a module with user/password authentication', async () => {
    const config: FtpSourceConfig = {
      ...base,
      id: 'docker-ftp-auth',
      anonymous: false,
      username: 'mibtest',
      passwordRef: 'fixture-password',
    };
    await expect(
      new FtpSource(config, client, async () => 'mibtest').fetch('FIXTURE-MIB'),
    ).resolves.toMatchObject({ status: 'found', moduleName: 'FIXTURE-MIB' });
  });
});
