/**
 * The archive path grammar: the root directory names, the depth the layout
 * goes to, and the trailing-slash rule that tells a directory entry from a
 * file. {@link parseArchivePath} reads a path into the tree position it
 * addresses; {@link buildArchivePath} builds one, refusing a position the
 * parser would place nowhere but `other`. The two share this one definition,
 * so a path the builder builds is always a path the parser can place, and
 * `packSpaceArchive` (`exportTar.ts`) names every entry it writes through the
 * builder before a pack is ever created.
 */
import { parseChunkDirName } from './resourceFileName.js'

/**
 * The archive's own manifest file name, the first entry of every archive.
 */
export const ARCHIVE_MANIFEST_FILE = 'manifest.yml'

/**
 * The exporting server's Service Description, carried verbatim beside the
 * manifest. Absent from an archive written by a server that had none to
 * declare, and from every archive written before the entry existed.
 */
export const ARCHIVE_SERVICE_FILE = 'service.json'

/**
 * The archive's top-level directory holding the `<spaceId>/` tree.
 */
export const ARCHIVE_SPACE_DIR = 'space'

/**
 * The archive's top-level directory holding the Space-scoped zcap revocation
 * records; absent when the Space has none.
 */
export const ARCHIVE_REVOCATIONS_DIR = 'revocations'

/**
 * Where one archive path sits in the archive tree. A directory entry carries
 * the same shape as the file entries under it, minus a `fileName`; the caller
 * tells the two apart by the entry's `type`. `spaceRoot` is the writer's own
 * `space/` directory entry, the one directory the layout holds above a Space
 * id; a bare file named `space` (no trailing slash) matches nothing in the
 * layout and parses as `other`.
 */
export type ArchivePath =
  | { area: 'manifest' }
  | { area: 'service' }
  | { area: 'spaceRoot' }
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
 * path with an empty segment, one deeper than the layout goes, or a directory
 * where the layout holds none -- a Collection-dir entry that is not a chunk
 * directory, or anything inside a chunk directory -- is `other`.
 * @param path {string}
 * @returns {ArchivePath}
 */
export function parseArchivePath(path: string): ArchivePath {
  const isDirectory = path.endsWith('/')
  const trimmed = isDirectory ? path.slice(0, -1) : path
  if (trimmed === ARCHIVE_MANIFEST_FILE) {
    return isDirectory ? { area: 'other' } : { area: 'manifest' }
  }
  if (trimmed === ARCHIVE_SERVICE_FILE) {
    return isDirectory ? { area: 'other' } : { area: 'service' }
  }
  const segments = trimmed.split('/')
  if (segments.includes('')) {
    return { area: 'other' }
  }
  const [root, ...rest] = segments
  if (root === ARCHIVE_REVOCATIONS_DIR) {
    const [fileName] = rest
    if (fileName === undefined) {
      return isDirectory
        ? { area: 'revocations', fileName: '' }
        : { area: 'other' }
    }
    // Revocation records are flat files: no nesting under `revocations/`.
    return rest.length > 1 || isDirectory
      ? { area: 'other' }
      : { area: 'revocations', fileName }
  }
  if (root !== ARCHIVE_SPACE_DIR) {
    return { area: 'other' }
  }
  const [spaceId, second, third, fourth] = rest
  if (spaceId === undefined) {
    // The writer's own `space/` directory entry.
    return isDirectory ? { area: 'spaceRoot' } : { area: 'other' }
  }
  // A chunk file is the deepest path the layout holds.
  if (rest.length > 4) {
    return { area: 'other' }
  }
  if (second === undefined) {
    return isDirectory
      ? { area: 'space', spaceId, fileName: '' }
      : { area: 'other' }
  }
  if (third === undefined) {
    // The only directories a Space directory holds are its Collections.
    return isDirectory
      ? { area: 'collection', spaceId, collectionId: second, fileName: '' }
      : { area: 'space', spaceId, fileName: second }
  }
  const chunkResourceId = parseChunkDirName(third)
  if (chunkResourceId !== undefined) {
    if (fourth === undefined) {
      return isDirectory
        ? {
            area: 'chunk',
            spaceId,
            collectionId: second,
            resourceId: chunkResourceId,
            fileName: ''
          }
        : { area: 'other' }
    }
    // No directory nests inside a chunk directory.
    return isDirectory
      ? { area: 'other' }
      : {
          area: 'chunk',
          spaceId,
          collectionId: second,
          resourceId: chunkResourceId,
          fileName: fourth
        }
  }
  // A directory here would have to be a chunk directory; anything else with a
  // trailing slash, or a file nested past a Collection dir, has no place in
  // the layout.
  if (fourth !== undefined || isDirectory) {
    return { area: 'other' }
  }
  return {
    area: 'collection',
    spaceId,
    collectionId: second,
    fileName: third
  }
}

/**
 * Builds one archive entry's path from its parent directory's path and its
 * own name, refusing a name or a resulting position {@link parseArchivePath}
 * would place as `other`. The single builder `packSpaceArchive` names every
 * entry through before its pack is created, so a tree the packer accepts is
 * always a tree the reader can place.
 * @param options {object}
 * @param options.name {string}   the entry's own name; refused if empty or if
 *   it embeds a `/`
 * @param [options.parentPath] {string}   the parent directory's own archive
 *   path (no trailing slash); omitted for a top-level root (`space/`,
 *   `revocations/`)
 * @param options.isDirectory {boolean}
 * @returns {string}   the entry's archive path, without a trailing slash even
 *   for a directory -- the caller appends one for the tar header
 */
export function buildArchivePath({
  name,
  parentPath,
  isDirectory
}: {
  name: string
  parentPath?: string
  isDirectory: boolean
}): string {
  if (name === '' || name.includes('/')) {
    throw new Error(
      `The archive entry name "${name}" is not a single path segment.`
    )
  }
  const path = parentPath === undefined ? name : `${parentPath}/${name}`
  const candidate = isDirectory ? `${path}/` : path
  if (parseArchivePath(candidate).area === 'other') {
    throw new Error(
      `The archive path "${candidate}" is nested deeper than the layout goes, or sits in a directory the layout does not define.`
    )
  }
  return path
}
