const path = require('path');
require('../Backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../Backend/.env') });
const storageService = require('../Backend/services/storageService');

async function main() {
  const exists = await storageService.fileExists('documents/GP0001N/2026/10/28dcffc0-3c36-4374-8641-39351b8eef1d.pdf');
  console.log('File exists in storage?', exists);
}

main();
