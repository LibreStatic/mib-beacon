const path = require('node:path');
const { notarize } = require('@electron/notarize');

module.exports = async function notarizeMacApplication(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const credentials = {
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  };
  const configured = Object.values(credentials).filter(Boolean).length;
  if (configured === 0) {
    console.warn('MACOS_NOTARIZATION_SKIPPED: Apple credentials are not configured; publishing documented unsigned artifacts.');
    return;
  }
  if (configured !== 3) throw new Error('Apple notarization credentials are incomplete. APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are all required.');
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await notarize({ appPath, ...credentials });
};
