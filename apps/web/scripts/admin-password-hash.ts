import { hashPassword } from '../lib/admin/password.ts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks).toString('utf8');
if (!password) {
  console.error('falta la clave');
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
