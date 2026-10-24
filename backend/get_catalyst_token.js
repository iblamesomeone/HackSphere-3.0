#!/usr/bin/env node
/**
 * Internal OAuth Token Provider for Catalyst CLI session
 * Extracts decrypted active access token from Catalyst CLI configStore,
 * automatically refreshing it via CLI when expired.
 */

const path = require('path');
const fs = require('fs');
const cp = require('child_process');

try {
  const candidatePaths = [
    '/Users/lakshitsinghvi/.npm-global/lib/node_modules/zcatalyst-cli',
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/zcatalyst-cli'),
    '/usr/local/lib/node_modules/zcatalyst-cli'
  ];

  let cliPath = '';
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      cliPath = p;
      break;
    }
  }

  if (!cliPath) process.exit(1);

  const configStore = require(cliPath + '/lib/util_modules/config-store.js').default;
  const dc = require(cliPath + '/lib/util_modules/dc.js');
  const Credential = require(cliPath + '/lib/authentication/credential.js').default;

  const activeDC = dc.getActiveDC();
  let encryptedToken = configStore.get(activeDC + '.credential', null);
  if (!encryptedToken) process.exit(1);

  let decrypted = Credential.crypt.decrypt(encryptedToken);

  // If expired or expiring within 60 seconds, trigger CLI refresh
  if (!decrypted || !decrypted.expires_at || decrypted.expires_at <= Date.now() + 60000) {
    try {
      cp.execSync('catalyst project:list --org 60093044321 --non-interactive', {
        stdio: 'ignore',
        timeout: 10000
      });
      encryptedToken = configStore.get(activeDC + '.credential', null);
      if (encryptedToken) {
        decrypted = Credential.crypt.decrypt(encryptedToken);
      }
    } catch (_) {}
  }

  if (decrypted && decrypted.access_token) {
    process.stdout.write(decrypted.access_token);
    process.exit(0);
  }

  process.exit(1);
} catch (e) {
  process.exit(1);
}
