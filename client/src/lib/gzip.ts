export const compress = async (input: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([input as BufferSource])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const decompress = async (input: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([input as BufferSource])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const isGzip = (data: Uint8Array) =>
  data[0] === 0x1f && data[1] === 0x8b;
