import { buildApp } from './app.js';
const port=Number(process.env.PORT??4300);const password=process.env.ADMIN_PASSWORD; if(!password)throw new Error('ADMIN_PASSWORD is required');
const app=await buildApp({database:process.env.DATABASE_PATH??'.data/reviewdesk',adminPassword:password,uploadDir:process.env.UPLOAD_DIR??'.data/uploads'});
await app.listen({host:process.env.HOST??'127.0.0.1',port});
