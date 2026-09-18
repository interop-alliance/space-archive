/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The lazy tar walk both readers share: a byte source in, one entry at a time
 * out, with each entry's bytes read on demand. Nothing is buffered beyond the
 * entry the caller is holding, so a Space archive of any size walks in bounded
 * memory, and a caller that stops early (the bundle reader, once it has found
 * the Space archive it wanted) tears the extraction down rather than draining
 * the rest.
 */
import * as tar from 'tar-stream'
import { BundleInvalidError } from './errors.js'
import { byteChunks, collectBytes } from './stream.js'
import type { ByteSource } from './stream.js'

/**
 * One entry of a tar archive, with its bytes behind a thunk: a caller that
 * only reads the header skips the body, and a caller that wants the body pays
 * for exactly that entry.
 */
export interface TarEntry {
  name: string
  type: string
  bytes: () => Promise<Uint8Array>
}

/**
 * Feeds a byte source into an extraction stream, honoring backpressure so a
 * large source never outruns the consumer. A failure on either side destroys
 * the extraction, which is where the caller's `for await` sees it. Resolves
 * with the source's own failure as `sourceError`, when there was one, so the
 * walk can tell it from a malformed tar.
 * @param options {object}
 * @param options.extract {tar.Extract}
 * @param options.source {ByteSource}
 * @returns {Promise<{ sourceError?: unknown }>}
 */
async function pumpIntoExtract({
  extract,
  source
}: {
  extract: tar.Extract
  source: ByteSource
}): Promise<{ sourceError?: unknown }> {
  try {
    for await (const chunk of byteChunks(source)) {
      // A consumer that stopped early destroyed the extraction, and nothing
      // written from here on would ever drain: the wait below would never
      // settle and the walk's teardown would hang on this pump.
      if (extract.destroyed) {
        return {}
      }
      if (!extract.write(chunk)) {
        await new Promise<void>(resolve => {
          // Only one of the three fires per wait, so whichever does takes the
          // other two listeners down with it. The extraction's own failure
          // reaches the walk through its `for await`, so it only ends the
          // wait here.
          function settle(): void {
            extract.off('drain', settle)
            extract.off('close', settle)
            extract.off('error', settle)
            resolve()
          }
          extract.on('drain', settle)
          extract.on('close', settle)
          extract.on('error', settle)
        })
        if (extract.destroying) {
          return {}
        }
      }
    }
    // An explicit `undefined`: streamx's `end` is typed as taking a final
    // chunk, and there is none here.
    extract.end(undefined)
    return {}
  } catch (err) {
    extract.destroy(err as Error)
    return { sourceError: err }
  }
}

/**
 * Walks a tar archive's entries in archive order. One-shot: the returned
 * iterator consumes the source as it goes, so it cannot be restarted or read
 * twice. An entry's `bytes()` is called at most once, and before the walk
 * advances; any other call rejects rather than resolving to nothing. Bytes
 * that do not parse as a tar (garbage, a truncated archive) are refused with
 * a `BundleInvalidError`; a failure of the source itself travels as thrown.
 * @param source {ByteSource}
 * @returns {AsyncGenerator<TarEntry>}
 */
export async function* tarEntries(
  source: ByteSource
): AsyncGenerator<TarEntry> {
  const extract = tar.extract()
  // Not awaited: the pump runs alongside the walk below, and its failures
  // reach the caller by destroying the extraction stream.
  const pumped = pumpIntoExtract({ extract, source })

  // What a failed walk throws: the source's own failure when it had one,
  // and otherwise a refusal of the bytes, since the tar did not parse.
  async function walkFailure(err: unknown): Promise<unknown> {
    extract.destroy()
    const pumpResult = await pumped
    if ('sourceError' in pumpResult) {
      return pumpResult.sourceError
    }
    return new BundleInvalidError('The bytes are not a readable tar archive.', {
      cause: err
    })
  }

  try {
    for await (const entry of extract) {
      let consumed = false
      let advanced = false
      yield {
        name: entry.header.name,
        type: entry.header.type ?? 'file',
        bytes: async () => {
          if (consumed) {
            throw new Error(
              `The bytes of tar entry "${entry.header.name}" were already read.`
            )
          }
          if (advanced) {
            throw new Error(
              `The tar walk has moved past entry "${entry.header.name}"; its bytes are read before the walk advances.`
            )
          }
          consumed = true
          try {
            return await collectBytes(
              entry as unknown as AsyncIterable<Uint8Array>
            )
          } catch (err) {
            // A body cut short fails here, in the caller's read, before the
            // walk itself sees it.
            throw await walkFailure(err)
          }
        }
      }
      advanced = true
      if (!consumed) {
        // An entry whose bytes the caller never asked for still has to be
        // drained before the next header arrives.
        entry.resume()
      }
    }
  } catch (err) {
    throw await walkFailure(err)
  } finally {
    extract.destroy()
    await pumped
  }
}
