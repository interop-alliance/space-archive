/**
 * Builder for the Space-export `manifest.yml` document (UBC v0.1, FEP-6fcd).
 * Every caller synthesizes the same archive layout (`space/<spaceId>/...`
 * entries in the file-name dialect of `resourceFileName.ts`), whatever storage
 * it reads from, so an archive exported by one imports into another. This
 * module is the single home for the manifest that describes it.
 */
import {
  ARCHIVE_DID_LOG_FILE,
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_PROVENANCE_FILE,
  ARCHIVE_REVOCATIONS_DIR,
  ARCHIVE_SPACE_DIR
} from './archivePath.js'
import {
  UBC_MANIFEST_URL,
  SPACE_URL,
  COLLECTION_URL,
  RESOURCE_URL,
  POLICY_URL,
  META_URL
} from './manifestUrls.js'
import {
  classifyCollectionFile,
  parseCollectionMetadataFileName
} from './resourceFileName.js'
import type { CollectionFileKind } from './resourceFileName.js'

/**
 * Fixed `mtime` for every entry in an export archive. `tar-stream` defaults a
 * header's `mtime` to the wall-clock time it was packed, which makes two
 * exports of an unchanged Space differ whenever they straddle a one-second
 * boundary. Pinning it to the Unix epoch makes an export a pure function of
 * the Space's contents (byte-reproducible and diff-stable); the timestamp
 * carries no meaning a consumer relies on.
 */
export const EXPORT_ENTRY_MTIME = new Date(0)

/**
 * One top-level entry of the Space being exported, in archive order: a
 * Space-level file (`files` absent) or a Collection directory with its ordered
 * file names.
 */
export interface ExportSpaceEntry {
  name: string
  /** present for a Collection directory: its file names, in archive order */
  files?: string[]
}

/**
 * The documenting `url` of each Collection-dir file kind the manifest annotates.
 * A kind absent here is listed by bare name.
 */
const MANIFEST_URL_BY_KIND: Partial<
  Record<CollectionFileKind['kind'], string>
> = {
  policy: POLICY_URL,
  resourcePolicy: POLICY_URL,
  collectionMetadata: COLLECTION_URL,
  metaSidecar: META_URL,
  representation: RESOURCE_URL
}

/**
 * Classifies one Collection-dir file name into its manifest entry: the known
 * dot-file kinds and resource representations get a documenting `url`, anything
 * else is listed by bare name. A chunk directory's child arrives as its
 * `<dirName>/<fileName>` path and is listed by that bare path. The classifier
 * reads basenames, so a path is not handed to it.
 * @param fileName {string}
 * @returns {unknown}
 */
function collectionManifestEntry(fileName: string): unknown {
  if (fileName.includes('/')) {
    return fileName
  }
  const url = MANIFEST_URL_BY_KIND[classifyCollectionFile(fileName).kind]
  return url === undefined ? fileName : { [fileName]: { url } }
}

/**
 * Lists one Space-level file. A Collection Metadata file in the Space
 * directory is a Collection tombstone, listed with its documenting `url` and
 * `deleted: true`. Any other Space-level file is listed by bare name.
 * @param fileName {string}
 * @returns {unknown}
 */
function spaceManifestEntry(fileName: string): unknown {
  if (parseCollectionMetadataFileName(fileName) === undefined) {
    return fileName
  }
  return { [fileName]: { url: COLLECTION_URL, deleted: true } }
}

/**
 * Builds the UBC v0.1 manifest object for a Space export. The caller supplies
 * the archive's top-level entries in the order they will be packed (Space-level
 * files interleaved with Collection directories); the manifest mirrors that
 * order. A Collection tombstone (a `.collection.<collectionId>.json` file
 * among the Space-level files) is listed with `deleted: true`; a live
 * Collection's entries carry no `deleted` member.
 * @param options {object}
 * @param options.spaceId {string}
 * @param options.entries {ExportSpaceEntry[]}   ordered top-level entries
 * @param [options.revocationFiles] {string[]}   ordered file names of the
 *   archive's Space-scoped zcap revocation records (`revocations/` entries);
 *   omitted from the manifest when the Space has none
 * @param [options.provenance] {boolean}   whether the archive carries a
 *   `provenance.jsonl` entry, listed right after the manifest's own entry
 * @param [options.didLog] {boolean}   whether the archive carries a
 *   `did.jsonl` entry, listed after `provenance.jsonl`
 * @returns {object}   the manifest document (serialize with `YAML.stringify`)
 */
export function buildExportManifest({
  spaceId,
  entries,
  revocationFiles = [],
  provenance = false,
  didLog = false
}: {
  spaceId: string
  entries: ExportSpaceEntry[]
  revocationFiles?: string[]
  provenance?: boolean
  didLog?: boolean
}): object {
  const spaceContents: unknown[] = []
  for (const entry of entries) {
    if (entry.files === undefined) {
      spaceContents.push(spaceManifestEntry(entry.name))
      continue
    }
    spaceContents.push({
      [entry.name]: {
        contents: entry.files.map(collectionManifestEntry)
      }
    })
  }

  return {
    'ubc-version': '0.1',
    contents: {
      [ARCHIVE_MANIFEST_FILE]: { url: UBC_MANIFEST_URL },
      // Listed by name with no documenting `url`: no specification section
      // describes either entry yet.
      ...(provenance && { [ARCHIVE_PROVENANCE_FILE]: {} }),
      ...(didLog && { [ARCHIVE_DID_LOG_FILE]: {} }),
      ...(revocationFiles.length > 0 && {
        [ARCHIVE_REVOCATIONS_DIR]: { contents: [...revocationFiles] }
      }),
      [ARCHIVE_SPACE_DIR]: {
        url: SPACE_URL,
        contents: {
          [spaceId]: {
            url: SPACE_URL,
            contents: spaceContents
          }
        }
      }
    }
  }
}
