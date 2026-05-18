const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!process.env.APPLE_ID) return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
