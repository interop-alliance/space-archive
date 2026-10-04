/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
import * as tar from 'tar-stream'
import { collectBytes } from '../../src/index.js'

/**
 * Packs a raw tar directly (bypassing the Space archive writer), for the
 * malformed inputs the writer itself would never produce.
 * @param entries {Array<{ name: string, body?: string | Uint8Array, header?: object }>}
 *   `header` carries any further tar header fields (a `type`, a `linkname`)
 * @returns {Promise<Uint8Array>}
 */
export async function packRawTar(
  entries: {
    name: string
    body?: string | Uint8Array
    header?: Partial<tar.Header>
  }[]
): Promise<Uint8Array> {
  const pack = tar.pack()
  for (const entry of entries) {
    pack.entry({ ...entry.header, name: entry.name }, entry.body ?? '')
  }
  pack.finalize()
  return collectBytes(pack as unknown as AsyncIterable<Uint8Array>)
}
