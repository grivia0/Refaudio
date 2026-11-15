import { guessMime } from './util';

export interface InboxEntry {
  name: string;
  size: number;
  modifiedAt: number;
}

export interface InboxListing {
  directory: string;
  files: InboxEntry[];
}

export interface InboxProgress {
  name: string;
  received: number;
  total: number;
  index: number;
  count: number;
}

function baseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * The inbox server is described in scripts/inbox-server.mjs. Empty setting means
 * "same origin" (Vite proxy in dev, or a tunnel that also serves /api).
 */
export async function listInbox(inboxUrl: string): Promise<InboxListing> {
  const response = await fetch(`${baseUrl(inboxUrl)}/api/files`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Inbox answered ${response.status} ${response.statusText}`);
  const data = (await response.json()) as Partial<InboxListing>;
  if (!data || !Array.isArray(data.files)) throw new Error('Inbox did not return a file list.');
  return {
    directory: data.directory ?? '',
    files: data.files
      .filter((entry): entry is InboxEntry => Boolean(entry) && typeof entry.name === 'string')
      .map((entry) => ({
        name: entry.name,
        size: Number(entry.size) || 0,
        modifiedAt: Number(entry.modifiedAt) || Date.now(),
      })),
  };
}

export async function fetchInboxFile(
  inboxUrl: string,
  entry: InboxEntry,
  onProgress?: (progress: InboxProgress) => void,
): Promise<File> {
  const url = `${baseUrl(inboxUrl)}/api/file/${encodeURIComponent(entry.name)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not download ${entry.name}: ${response.status}`);

  const type = guessMime(entry.name);
  const total = Number(response.headers.get('content-length')) || entry.size;
  let blob: Blob;

  if (response.body) {
    // Read manually so the progress bar moves on a slow Wi-Fi transfer.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.({ name: entry.name, received, total, index: 0, count: 1 });
      }
    }
    blob = new Blob(chunks as BlobPart[], { type });
  } else {
    blob = await response.blob();
  }

  return new File([blob], entry.name, {
    type,
    lastModified: entry.modifiedAt || Date.now(),
  });
}
