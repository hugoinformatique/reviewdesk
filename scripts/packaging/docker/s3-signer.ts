// Bundled to app/dist/s3-signer.js: the container entrypoint checks the bucket
// with the exact SigV4 signer the application uses.
export { signRequest } from '../../../src/storage/s3.js';
