// Generates the Ed25519 key pair used to sign GET /config.
// Put the PRIVATE key in CONFIG_SIGNING_PRIVATE_KEY (server only).
// Embed the PUBLIC key in the store app so it can verify /config.
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).trim();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).trim();
console.log('# CONFIG_SIGNING_PRIVATE_KEY (one line, for .env):');
console.log(priv.replace(/\n/g, '\\n'));
console.log('\n# PUBLIC KEY (embed in the store app):');
console.log(pub);
