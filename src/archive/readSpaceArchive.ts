/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The reader half of the per-Space archive codec: a UBC v0.1 Space export tar
 * in, its `manifest.yml` plus a lazy walk of its entries out. The writer
 * (`exportTar.ts`) packs the manifest first, so the manifest is in hand before
 * a single content entry is read and the rest of the archive stays a stream --
 * a Space archive is the largest thing in a backup bundle and is never held
 * whole.
 *
 * The archive path grammar -- root directory names, the `ArchivePath` type and
 * its parser -- lives in `archivePath.ts`, shared with the writer so a reader
 * and a writer can never disagree about what a path means.
 */
import YAML from 'yaml'
import { BundleInvalidError } from '../errors.js'
import { tarEntries } from '../tarEntries.js'
import type { TarEntry } from '../tarEntries.js'
import type { ByteSource } from '../stream.js'
import {
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_SERVICE_FILE,
  ARCHIVE_SPACE_DIR
} from './archivePath.js'

/**
 * A Space archive's `manifest.yml`, as parsed. Only the two members the reader
 * relies on are named: `contents` is the FEP-6fcd tree the writer built, read
 * for the Space id and otherwise passed through to the caller.
 */
export interface SpaceArchiveManifest {
  'ubc-version': string
  contents: Record<string, unknown>
}

/**
 * An opened Space archive: its manifest and Space id, read eagerly, and its
 * remaining entries as a one-shot lazy walk. An entry's `name` is its full
 * archive path, e.g. `space/<spaceId>/<collectionId>/r.<encId>.<encType>.json`.
 * The source stays open until the walk ends (it runs out, fails, or the caller
 * leaves the loop); a caller that never iterates `entries` calls `close()` to
 * release it.
 */
export interface SpaceArchive {
  spaceId: string
  manifest: SpaceArchiveManifest
  /**
   * The exporting server's Service Description, read verbatim from the
   * archive's `service.json`. `undefined` for an archive that carries none --
   * every archive written before the entry existed, and every export by a
   * server with no description to declare. Informational: it says which
   * specification versions and features the contents were written under, and
   * this codec neither checks it nor acts on it.
   */
  service?: Record<string, unknown>
  entries: AsyncIterable<TarEntry>
  close: () => Promise<void>
}

/**
 * Whether a parsed YAML value is a mapping, as opposed to a sequence, a scalar
 * or nothing.
 * @param value {unknown}
 * @returns {boolean}
 */
function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reads the Space id out of a parsed manifest: the single key under the
 * `space` directory entry's `contents`. Refuses a manifest whose `space` entry
 * or its `contents` is not a mapping, and one that lists several Space
 * directories.
 * @param manifest {SpaceArchiveManifest}
 * @returns {string}
 */
function manifestSpaceId(manifest: SpaceArchiveManifest): string {
  const space = manifest.contents[ARCHIVE_SPACE_DIR]
  const spaceIds =
    isMapping(space) && isMapping(space.contents)
      ? Object.keys(space.contents)
      : []
  const [spaceId] = spaceIds
  if (!spaceId) {
    throw new BundleInvalidError(
      'The Space archive manifest names no Space directory.'
    )
  }
  if (spaceIds.length > 1) {
    throw new BundleInvalidError(
      'The Space archive manifest names more than one Space directory.'
    )
  }
  return spaceId
}

/**
 * Parses an archive manifest document, refusing anything that is not a
 * manifest object carrying a `ubc-version`. The version itself is not checked
 * here. An unquoted `ubc-version: 0.1` parses as a YAML number and is read as
 * the string `'0.1'`.
 * @param options {object}
 * @param options.text {string}
 * @param options.label {string}   what the refusal calls the archive
 * @returns {SpaceArchiveManifest}
 */
export function parseArchiveManifest({
  text,
  label
}: {
  text: string
  label: string
}): SpaceArchiveManifest {
  let document: unknown
  try {
    document = YAML.parse(text)
  } catch (err) {
    throw new BundleInvalidError(`The ${label} manifest is not valid YAML.`, {
      cause: err
    })
  }
  if (!isMapping(document)) {
    throw new BundleInvalidError(`The ${label} manifest is not an object.`)
  }
  const version = document['ubc-version']
  if (typeof version !== 'string' && typeof version !== 'number') {
    throw new BundleInvalidError(
      `The ${label} manifest carries no "ubc-version".`
    )
  }
  // Members beyond the two this parse checks are carried through untouched:
  // the bundle manifest's `meta` and `spec` ride the same parse.
  return {
    ...document,
    'ubc-version': String(version),
    contents: isMapping(document.contents) ? document.contents : {}
  }
}

/**
 * Parses the archive's `service.json` body: the exporting server's Service
 * Description, carried verbatim. Refuses bytes that are not a JSON object,
 * since an entry under that name that is not one is a malformed archive rather
 * than a description this reader may pass on.
 * @param bytes {Uint8Array}
 * @returns {Record<string, unknown>}
 */
function parseServiceDescription(bytes: Uint8Array): Record<string, unknown> {
  let document: unknown
  try {
    document = JSON.parse(new TextDecoder().decode(bytes))
  } catch (err) {
    throw new BundleInvalidError(
      `The Space archive's "${ARCHIVE_SERVICE_FILE}" is not valid JSON.`,
      { cause: err }
    )
  }
  if (!isMapping(document)) {
    throw new BundleInvalidError(
      `The Space archive's "${ARCHIVE_SERVICE_FILE}" is not an object.`
    )
  }
  return document
}

/**
 * Yields one entry already pulled off the tar walk, then the rest of it. The
 * service-description peek reads one entry ahead, and this hands that entry
 * back to the caller in its place in the walk. Written as an iterator object
 * rather than a generator so that a `return()` before the first `next()` still
 * tears the walk down: a generator that has not started runs no `finally`.
 * @param options {object}
 * @param options.pending {TarEntry}
 * @param options.walk {AsyncGenerator<TarEntry>}
 * @returns {AsyncIterableIterator<TarEntry>}
 */
function replay({
  pending,
  walk
}: {
  pending: TarEntry
  walk: AsyncGenerator<TarEntry>
}): AsyncIterableIterator<TarEntry> {
  let replayed = false
  const iterator: AsyncIterableIterator<TarEntry> = {
    [Symbol.asyncIterator]() {
      return iterator
    },
    async next() {
      if (replayed) {
        return walk.next()
      }
      replayed = true
      return { done: false, value: pending }
    },
    async return() {
      await walk.return(undefined)
      return { done: true, value: undefined }
    }
  }
  return iterator
}

/**
 * Opens a Space export archive: reads its `manifest.yml` (the first entry) and
 * the exporting server's `service.json` where the archive carries one (the
 * entry immediately after), and hands back the manifest, that description, the
 * Space id the manifest describes, and a one-shot lazy walk of everything
 * after them. The walk consumes the source as it goes, so it is
 * iterated once and each entry's `bytes()` is called before the walk advances.
 * Bytes that are not a tar are refused with a `BundleInvalidError`.
 * @param source {ByteSource}   the archive's tar bytes, or a stream of them
 * @returns {Promise<SpaceArchive>}
 */
export async function readSpaceArchive(
  source: ByteSource
): Promise<SpaceArchive> {
  const walk = tarEntries(source)
  const first = await walk.next()
  if (first.done || first.value.name !== ARCHIVE_MANIFEST_FILE) {
    await walk.return(undefined)
    throw new BundleInvalidError(
      `The Space archive does not open with a "${ARCHIVE_MANIFEST_FILE}" entry.`
    )
  }
  let manifest: SpaceArchiveManifest
  let spaceId: string
  try {
    const text = new TextDecoder().decode(await first.value.bytes())
    manifest = parseArchiveManifest({ text, label: 'Space archive' })
    spaceId = manifestSpaceId(manifest)
  } catch (err) {
    // The tar walk is open by now, and with it the source; tear it down
    // before the refusal travels.
    await walk.return(undefined)
    throw err
  }

  async function close(): Promise<void> {
    await walk.return(undefined)
  }

  // The writer places `service.json` immediately after the manifest, so one
  // peek settles whether the archive carries one. An archive without it opens
  // on its first content entry, which the walk below then yields.
  let service: Record<string, unknown> | undefined
  let pending: TarEntry | undefined
  const second = await walk.next()
  if (!second.done) {
    // Only a regular file is the description; a symlink or other entry type
    // under that name is content, passed on like any other entry.
    if (
      second.value.name === ARCHIVE_SERVICE_FILE &&
      second.value.type === 'file'
    ) {
      try {
        service = parseServiceDescription(await second.value.bytes())
      } catch (err) {
        await walk.return(undefined)
        throw err
      }
    } else {
      pending = second.value
    }
  }

  // The walk is handed back as it stands: the reads above have started it, so
  // leaving the loop (or `close()`) runs its teardown. An entry already pulled
  // off it is yielded ahead of the rest, so the caller sees every content
  // entry exactly once.
  const entries = pending === undefined ? walk : replay({ pending, walk })
  return { spaceId, manifest, service, entries, close }
}
