// Worker thread: parses an audio file's metadata off the event loop. Sent a
// path, returns the metadata fields the main thread needs (no buffers — the
// picture data crosses the worker boundary as a transferable Buffer to keep
// the cost down).

const { parentPort } = require('node:worker_threads');
const { parseFile } = require('music-metadata');

if (!parentPort) {
  // Loaded outside a worker context — bail out quietly so a stray require()
  // doesn't blow up.
  return;
}

parentPort.on('message', async (job) => {
  const { id, filePath } = job;
  try {
    const metadata = await parseFile(filePath);
    const genre = metadata.common.genre ? metadata.common.genre[0] : null;
    const picture = metadata.common.picture && metadata.common.picture[0];

    const result = {
      id,
      ok: true,
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      albumArtist: metadata.common.albumartist || null,
      album: metadata.common.album || null,
      year: metadata.common.year || null,
      duration: metadata.format.duration || 0,
      genre,
      picture: picture
        ? {
            // Buffer is transferable; the main thread receives a Uint8Array.
            data: picture.data,
            format: picture.format || null,
          }
        : null,
    };

    // Transfer the picture buffer to avoid copying a few MB per cover when
    // libraries are large.
    const transferList = picture && picture.data && picture.data.buffer
      ? [picture.data.buffer]
      : [];
    parentPort.postMessage(result, transferList);
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
