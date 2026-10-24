#!/usr/bin/env node
/**
 * Internal OAuth Token Provider for Catalyst CLI session
 * Extracts decrypted active access token from Catalyst CLI configStore.
 */

try {
  const path = require('path');
  const fs = require('fs');

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
  const encryptedToken = configStore.get(activeDC + '.credential', null);
  if (!encryptedToken) process.exit(1);

  const decrypted = Credential.crypt.decrypt(encryptedToken);
  if (decrypted && decrypted.access_token) {
    process.stdout.write(decrypted.access_token);
    process.exit(0);
  }

  process.exit(1);
} catch (e) {
  process.exit(1);
}
