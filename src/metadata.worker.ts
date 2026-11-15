import { parseBlob } from 'music-metadata';
import type { ParseResponse } from './types';

// The worker entry is bundled by Vite; `self` is typed as Window by the DOM lib,
// so we narrow it to the shape we actually use.
const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<{ key: string; file: File }>) => {
  const { key, file } = event.data;
  try {
    const { common, format } = await parseBlob(file, { duration: true });
    const picture = common.picture?.[0];
    const coverBuffer = picture
      ? (new Uint8Array(picture.data).slice().buffer as ArrayBuffer)
      : null;

    const response: ParseResponse = {
      key,
      ok: true,
      meta: {
        title: common.title?.trim() ?? '',
        artist: common.artist?.trim() || common.artists?.join(', ') || '',
        albumArtist: common.albumartist?.trim() ?? '',
        album: common.album?.trim() ?? '',
        genre: common.genre?.join(', ') ?? '',
        year: common.year ?? 0,
        trackNo: common.track?.no ?? 0,
        discNo: common.disk?.no ?? 0,
        duration: format.duration ?? 0,
        codec: format.codec ?? '',
        container: format.container ?? '',
        bitrate: Math.round(format.bitrate ?? 0),
        sampleRate: format.sampleRate ?? 0,
        channels: format.numberOfChannels ?? 0,
      },
      cover: picture && coverBuffer ? { type: picture.format, buffer: coverBuffer } : null,
    };

    ctx.postMessage(response, coverBuffer ? [coverBuffer] : []);
  } catch (error) {
    const response: ParseResponse = {
      key,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
