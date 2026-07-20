import { createRequire } from 'node:module';
import path from 'node:path';

const packageRequire = createRequire(path.join(process.cwd(), 'package.json'));
await import(packageRequire.resolve('alchemy/bin/alchemy.js'));
