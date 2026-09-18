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
 * The path parser here reads an entry's path through the very codec the writer
 * names it with (`resourceFileName.ts`, which also classifies a file name), so
 * a reader and a writer can never disagree about what a name means.
 */
import YAML from 'yaml'
import { BundleInvalidError } from '../errors.js'
import { tarEntries } from '../tarEntries.js'
import type { TarEntry } from '../tarEntries.js'
import type { ByteSource } from '../stream.js'
import {
  parseChunkDirName,
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_REVOCATIONS_DIR,
  ARCHIVE_SPACE_DIR
} from './resourceFileName.js'

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
 * Opens a Space export archive: reads its `manifest.yml` (the first entry) and
 * hands back the manifest, the Space id it describes, and a one-shot lazy walk
 * of everything after it. The walk consumes the source as it goes, so it is
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

  // The walk is handed back as it stands: the manifest read has started it,
  // so leaving the loop (or `close()`) runs its teardown.
  return { spaceId, manifest, entries: walk, close }
}

/**
 * Where one archive path sits in the archive tree. A directory entry carries
 * the same shape as the file entries under it, minus a `fileName`; the caller
 * tells the two apart by the entry's `type`.
 */
export type ArchivePath =
  | { area: 'manifest' }
  | { area: 'space'; spaceId: string; fileName: string }
  | {
      area: 'collection'
      spaceId: string
      collectionId: string
      fileName: string
    }
  | {
      area: 'chunk'
      spaceId: string
      collectionId: string
      resourceId: string
      fileName: string
    }
  | { area: 'revocations'; fileName: string }
  | { area: 'other' }

/**
 * Parses an archive entry path into the tree position it addresses. A trailing
 * slash marks a directory entry, which parses as that directory with an empty
 * `fileName`: `space/<id>/<c>/` is the Collection directory `<c>`, where
 * `space/<id>/<name>` without the slash is a file of the Space directory. A
 * path with an empty segment, or one deeper than the layout goes, is `other`.
 * @param path {string}
 * @returns {ArchivePath}
 */
export function parseArchivePath(path: string): ArchivePath {
  const isDirectory = path.endsWith('/')
  const trimmed = isDirectory ? path.slice(0, -1) : path
  if (trimmed === ARCHIVE_MANIFEST_FILE) {
    return { area: 'manifest' }
  }
  const segments = trimmed.split('/')
  if (segments.includes('')) {
    return { area: 'other' }
  }
  const [root, ...rest] = segments
  if (root === ARCHIVE_REVOCATIONS_DIR) {
    return { area: 'revocations', fileName: rest.join('/') }
  }
  if (root !== ARCHIVE_SPACE_DIR) {
    return { area: 'other' }
  }
  const [spaceId, second, third, fourth] = rest
  // A chunk file is the deepest path the layout holds.
  if (!spaceId || rest.length > 4) {
    return { area: 'other' }
  }
  if (second === undefined) {
    return { area: 'space', spaceId, fileName: '' }
  }
  if (third === undefined) {
    // The only directories a Space directory holds are its Collections.
    return isDirectory
      ? { area: 'collection', spaceId, collectionId: second, fileName: '' }
      : { area: 'space', spaceId, fileName: second }
  }
  const chunkResourceId = parseChunkDirName(third)
  if (chunkResourceId !== undefined) {
    return {
      area: 'chunk',
      spaceId,
      collectionId: second,
      resourceId: chunkResourceId,
      fileName: fourth ?? ''
    }
  }
  if (fourth !== undefined) {
    return { area: 'other' }
  }
  return {
    area: 'collection',
    spaceId,
    collectionId: second,
    fileName: third
  }
}
