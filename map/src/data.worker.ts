/** Decompress and parse the large geometry away from the UI thread. */
self.onmessage = async (event: MessageEvent<string>) => {
  try {
    const response = await fetch(event.data);
    if (!response.ok || !response.body) throw new Error(`Map download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A host may transparently decode .gz via Content-Encoding.
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const stream = new Blob([bytes]).stream();
    const decoded = compressed ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
    const data = await new Response(decoded).json();
    self.postMessage({ data });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not load map data.' });
  }
};
