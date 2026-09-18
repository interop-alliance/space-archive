/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The one byte-source adapter the codecs read through: a whole `Uint8Array`, a
 * web `ReadableStream`, or any async iterable of chunks (a Node `Readable` and
 * a tar-stream pack are both that). Reading through one adapter is what keeps
 * the reader isomorphic -- nothing here imports `node:stream`, and a browser
 * caller hands a `Response.body` where a Node caller hands a file stream.
 */

/**
 * Anything the archive and bundle readers accept as their input bytes.
 */
export type ByteSource =
  | Uint8Array
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>

/**
 * Normalizes a byte source into an async iterable of chunks. A `Uint8Array`
 * yields once; a web `ReadableStream` is drained through its reader, since a
 * browser's implementation is not itself async-iterable.
 * @param source {ByteSource}
 * @returns {AsyncIterable<Uint8Array>}
 */
export async function* byteChunks(
  source: ByteSource
): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source
    return
  }
  const stream = source as ReadableStream<Uint8Array>
  if (typeof stream.getReader !== 'function') {
    yield* source as AsyncIterable<Uint8Array>
    return
  }
  const reader = stream.getReader()
  let settled = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        settled = true
        return
      }
      if (value) {
        yield value
      }
    }
  } catch (err) {
    settled = true
    throw err
  } finally {
    // A consumer that stopped early leaves the stream open: cancel it, so a
    // `Response.body` stops downloading bytes nobody will read.
    if (!settled) {
      await reader.cancel()
    }
    reader.releaseLock()
  }
}

/**
 * Drains a byte source into one `Uint8Array`. For the callers that need the
 * whole thing in hand (a packed archive a test compares byte for byte, a Space
 * tar handed to the migration walk); a streaming caller uses
 * {@link byteChunks} instead.
 * @param source {ByteSource}
 * @returns {Promise<Uint8Array>}
 */
export async function collectBytes(source: ByteSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source
  }
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of byteChunks(source)) {
    chunks.push(chunk)
    length += chunk.byteLength
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
