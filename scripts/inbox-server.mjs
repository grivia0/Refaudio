#!/usr/bin/env node
// Zero-dependency LAN file inbox + static host for the built PWA.
//
//   npm run inbox                      # serves ./dist and ~/Music/Refaudio-Inbox
//   PORT=9000 INBOX_DIR=/mnt/music npm run inbox
//
// API:
//   GET /api/files          → { directory, files: [{ name, size, modifiedAt }] }
//   GET /api/file/:name     → file bytes (Range supported)
//   GET /inbox              → simple HTML listing, handy from a PC browser
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const INBOX = resolve(process.env.INBOX_DIR ?? join(homedir(), 'Music', 'Refaudio-Inbox'));
const PORT = Number(process.env.PORT ?? 8765);
const HOST = process.env.HOST ?? '0.0.0.0';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.aif', '.aiff', '.caf']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.zip': 'application/zip',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range,Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function audioFiles() {
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX)
    .filter((name) => AUDIO_EXT.has(extname(name).toLowerCase()))
    .map((name) => {
      const info = statSync(join(INBOX, name));
      return { name, size: info.size, modifiedAt: info.mtimeMs };
    })
    .filter((entry) => entry.size > 0)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * Header values may only carry latin1, so a name like "Björk – Jóga.mp3" makes
 * writeHead throw ERR_INVALID_CHAR and takes the whole server down. Send a
 * plain ASCII fallback plus the real name as RFC 5987 UTF-8, which Safari reads.
 */
function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim();
  const fallback = ascii === '' || ascii === '.' || ascii === '..' ? 'download' : ascii;
  const encoded = [...Buffer.from(name, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${byte.toString(16).padStart(2, '0').toUpperCase()}`;
    })
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Streams a file, tolerating a phone that hangs up halfway through a transfer. */
function streamFile(req, res, filePath, options) {
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath, options);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function sendFile(req, res, filePath, downloadName) {
  const info = statSync(filePath);
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const total = info.size;
  const range = req.headers.range;
  cors(res);
  const disposition = downloadName ? { 'Content-Disposition': contentDisposition(downloadName) } : {};

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (Number.isNaN(start) || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      ...disposition,
    });
    streamFile(req, res, filePath, { start, end });
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...disposition,
  });
  streamFile(req, res, filePath);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function inboxPage(res) {
  const files = audioFiles();
  const rows = files
    .map(
      (file) =>
        `<li><a href="/api/file/${encodeURIComponent(file.name)}">${escapeHtml(file.name)}</a> <small>${(file.size / 1048576).toFixed(1)} MB</small></li>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Refaudio inbox</title>
<style>body{font:15px system-ui;background:#0b0b10;color:#eee;padding:28px;line-height:1.5}
a{color:#1edb72}li{margin:6px 0}code{background:#1b1b24;padding:2px 6px;border-radius:6px}</style>
<h1>Refaudio inbox</h1>
<p>Drop audio files into <code>${escapeHtml(INBOX)}</code>. This page just lists them.</p>
<p>${files.length} file(s) waiting.</p><ul>${rows || '<li>Nothing here yet.</li>'}</ul>`;
  cors(res);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/** `decodeURIComponent` throws on stray `%`; a bad request must not kill the process. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = safeDecode(url.pathname);
  if (path === null) {
    json(res, 400, { error: 'Malformed file name.' });
    return;
  }

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === '/api/files') {
    json(res, 200, { directory: INBOX, files: audioFiles() });
    return;
  }

  if (path.startsWith('/api/file/')) {
    const name = basename(path.slice('/api/file/'.length));
    const filePath = normalize(join(INBOX, name));
    if (!filePath.startsWith(INBOX + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      json(res, 404, { error: 'No such file in the inbox.' });
      return;
    }
    sendFile(req, res, filePath, name);
    return;
  }

  if (path === '/inbox') {
    inboxPage(res);
    return;
  }

  // Static PWA build.
  if (!existsSync(DIST)) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Refaudio has not been built yet.\n\nRun: npm run build\nThen open http://<this-pc-ip>:' +
        `${PORT}/ on your iPhone (or use npm run dev with the /api proxy).\n`,
    );
    return;
  }

  const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  const candidate = normalize(join(DIST, relative));
  if (candidate.startsWith(DIST + sep) && existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(req, res, candidate);
    return;
  }

  // SPA fallback so client-side navigation always boots the app.
  const fallback = join(DIST, 'index.html');
  if (existsSync(fallback)) {
    sendFile(req, res, fallback);
    return;
  }
  cors(res);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const server = createServer((req, res) => {
  try {
    handle(req, res);
  } catch (error) {
    console.error(`inbox-server: ${req.method} ${req.url} failed`, error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    cors(res);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Inbox server error');
  }
});

// A client that dies mid-connection must not take the server with it.
server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '<your-pc-ip>' : HOST;
  console.log('Refaudio inbox server');
  console.log(`  inbox folder : ${INBOX}`);
  console.log(`  app          : http://${shown}:${PORT}/`);
  console.log(`  folder list  : http://${shown}:${PORT}/inbox`);
  console.log(`  api          : http://${shown}:${PORT}/api/files`);
  if (!existsSync(INBOX)) console.log(`\n  Create the folder first: mkdir -p "${INBOX}"`);
  if (!existsSync(DIST)) console.log('\n  dist/ missing — run "npm run build" for the installable app.');
});
