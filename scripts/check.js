import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const html = await readFile(new URL('../src/widget.html', import.meta.url), 'utf8');
const bytes = Buffer.byteLength(html, 'utf8');
const compressed = deflateSync(Buffer.from(html, 'utf8'), { level: 9 }).length;
const match = html.match(/<script>([\s\S]*?)<\/script>/i);

if (!match) throw new Error('Widget script tag is missing.');
new Function(match[1]);

console.log(`Widget HTML: ${bytes} / 32768 bytes`);
console.log(`Zlib level 9: ${compressed} / 4096 bytes`);
if (bytes > 32768) throw new Error('Widget HTML exceeds Telegram size limit.');
if (compressed > 4096) throw new Error('Compressed widget HTML exceeds Telegram size limit.');
console.log('Widget checks passed.');
