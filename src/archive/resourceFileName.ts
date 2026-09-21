/**
 * File-name codec: the single shared home for the file names a per-Space
 * archive speaks. Every writer and reader of the layout builds and parses the
 * same names here. Covers a Resource's representation file name
 * (`r.<resourceId>.<encodedContentType>.<ext>`), a chunk directory
 * (`.chunks.<encodedResourceId>/`), and the JSON dot-files that carry the
 * Space / Collection descriptions, the access-control policies, and the
 * Resource metadata sidecars. The archive path grammar -- the root directory
 * names, and the parser and builder for a whole archive path -- lives in
 * `archivePath.ts`, which imports `parseChunkDirName` from here. Kept
 * low-level (no imports from the rest of `src/archive/`) so every consumer
 * can depend on it without an import cycle.
 */
import * as mime from 'mime-types'

/**
 * Prefix of a Resource representation file name
 * (`r.<resourceId>.<encodedContentType>.<ext>`) -- and, inside a chunk
 * directory, of a chunk representation (`r.<index>...`). The bare `r.` marks the
 * entry as content bytes (not a `.`-prefixed dot-file), so it is what a
 * Collection listing and an archive reader or writer filter a directory on.
 */
export const REPRESENTATION_PREFIX = 'r.'

/**
 * True when `fileName` is a Resource (or chunk) representation file -- i.e. it
 * carries the {@link REPRESENTATION_PREFIX}. The single shared test for the
 * content files every reader and writer of the layout selects a directory by.
 * @param fileName {string}
 * @returns {boolean}
 */
export function isRepresentationFileName(fileName: string): boolean {
  return fileName.startsWith(REPRESENTATION_PREFIX)
}

/**
 * Percent-encodes a filename segment so it carries no literal `.`, the
 * structural delimiter of `r.<resourceId>.<encodedContentType>.<ext>`.
 * `encodeURIComponent` leaves `.` unescaped, so escape it explicitly to `%2E`;
 * `decodeURIComponent` reverses both. This keeps resource ids and content-types
 * that legitimately contain dots (e.g. `index.html`, `application/vnd.api+json`)
 * unambiguously parseable -- without it, a dotted id mis-splits and is read back
 * under the wrong id and content-type. For dot-free segments (the common case)
 * the result is byte-identical to the previous `encodeURIComponent`-only scheme.
 * @param segment {string}
 * @returns {string}
 */
export function encodeFilenameSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/\./g, '%2E')
}

/**
 * Reverses {@link encodeFilenameSegment}. Returns `undefined` for a segment
 * that is not valid percent-encoding (`%zz`, a truncated UTF-8 sequence), which
 * `decodeURIComponent` throws on: a name read from an archive is input, and one
 * bad name is not a reason to fail the whole read.
 * @param segment {string}
 * @returns {string | undefined}
 */
function decodeFilenameSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch (err) {
    if (err instanceof URIError) {
      return undefined
    }
    throw err
  }
}

/**
 * Builds the on-disk filename for a resource representation:
 * `r.<resourceId>.<encodedContentType>.<ext>`. Both the `resourceId` and
 * content-type segments are dot-escaped (see {@link encodeFilenameSegment}) so
 * the three `.` separators are the only literal dots.
 * @param options {object}
 * @param options.resourceId {string}
 * @param options.contentType {string}
 * @returns {string}
 */
export function fileNameFor({
  resourceId,
  contentType
}: {
  resourceId: string
  contentType: string
}): string {
  const encodedId = encodeFilenameSegment(resourceId)
  const encodedType = encodeFilenameSegment(contentType)
  const extension = mime.extension(contentType) || 'blob'
  return `${REPRESENTATION_PREFIX}${encodedId}.${encodedType}.${extension}`
}

/**
 * Parses an on-disk resource filename (`r.<resourceId>.<encodedContentType>.<ext>`)
 * back into its components, reversing the dot-escaping {@link fileNameFor}
 * applies. Returns the exact stored content-type (decoded from the filename
 * segment, more reliable than `mime.lookup` on the extension), falling back to
 * the spec default `application/octet-stream` if unparseable. An id segment
 * that is missing or malformed comes back as the empty `resourceId`.
 * @param fileName {string}   the basename of the resource file
 * @returns {{ resourceId: string, contentType: string }}
 */
export function parseResourceFileName(fileName: string): {
  resourceId: string
  contentType: string
} {
  const [, encodedId, encodedType] = fileName.split('.')
  return {
    resourceId: decodeFilenameSegment(encodedId ?? '') ?? '',
    contentType:
      decodeFilenameSegment(encodedType ?? '') || 'application/octet-stream'
  }
}

/**
 * Prefix of a Resource's per-Resource chunk directory
 * (`.chunks.<encodedResourceId>/`), which holds the chunk representations of a
 * chunked Resource (the `chunked-streams` feature). The leading `.` keeps the
 * directory out of the `r.`-prefixed Collection listing, and dot-escaping the
 * id segment keeps it in one filesystem-name namespace with the Resource files.
 */
export const CHUNK_DIR_PREFIX = '.chunks.'

/**
 * Builds the on-disk directory name for a Resource's chunk directory:
 * `.chunks.<encodedResourceId>`. The id segment is dot-escaped (see
 * {@link encodeFilenameSegment}) so a dotted id round-trips.
 * @param resourceId {string}
 * @returns {string}
 */
export function chunkDirName(resourceId: string): string {
  return `${CHUNK_DIR_PREFIX}${encodeFilenameSegment(resourceId)}`
}

/**
 * Largest addressable chunk index: 2^31-1. It fits a signed 32-bit integer, so
 * every implementation of the layout can store it, and all of them agree on
 * the addressable range.
 */
export const MAX_CHUNK_INDEX = 2 ** 31 - 1

/**
 * Canonical non-negative decimal integer: `0`, or a digit run with no leading
 * zero. Rejecting non-canonical forms (`01`, `+1`, `1e3`) keeps every chunk
 * addressable at exactly one URL (and at exactly one archive file name).
 */
const CHUNK_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

/**
 * Parses a chunk-index segment -- the `:chunkIndex` path param, or the
 * `<index>` segment of a chunk file name (`r.<index>.<encType>.<ext>` /
 * `.meta.<index>.json`) -- into its number. Returns `undefined` unless the
 * segment is the canonical decimal form of an integer in
 * `[0, MAX_CHUNK_INDEX]`. The single shared predicate for every consumer of
 * the layout, so a chunk index means the same thing everywhere.
 * @param segment {string}
 * @returns {number | undefined}
 */
export function parseChunkIndexSegment(segment: string): number | undefined {
  if (!CHUNK_INDEX_PATTERN.test(segment)) {
    return undefined
  }
  const chunkIndex = Number(segment)
  return chunkIndex <= MAX_CHUNK_INDEX ? chunkIndex : undefined
}

/**
 * Parses a chunk directory name (`.chunks.<encodedResourceId>`) back into its
 * parent `resourceId`, reversing {@link chunkDirName}. Returns `undefined` when
 * the name is not a chunk directory (no matching prefix, or an empty or
 * malformed id segment).
 * @param dirName {string}   the basename of the directory
 * @returns {string | undefined}
 */
export function parseChunkDirName(dirName: string): string | undefined {
  if (!dirName.startsWith(CHUNK_DIR_PREFIX)) {
    return undefined
  }
  const encodedId = dirName.slice(CHUNK_DIR_PREFIX.length)
  return encodedId.length > 0 ? decodeFilenameSegment(encodedId) : undefined
}

/**
 * Suffix shared by the description / policy / metadata dot-files.
 */
export const JSON_FILE_SUFFIX = '.json'

/**
 * Prefix of a Space description dot-file (`.space.<spaceId>.json`).
 */
export const SPACE_FILE_PREFIX = '.space.'

/**
 * Prefix of a Collection description dot-file
 * (`.collection.<collectionId>.json`).
 */
export const COLLECTION_FILE_PREFIX = '.collection.'

/**
 * Suffix shared by the three access-control policy dot-files. Each is named
 * for the entity it governs, with a letter or word prefix per level so no two
 * levels can share a file name inside one directory: a Space's own policy is
 * {@link SPACE_POLICY_FILE_NAME} in the Space dir, a Collection's own policy
 * is {@link COLLECTION_POLICY_FILE_NAME} in the Collection dir, and a
 * Resource's policy is `.r.<resourceId>.policy.json` in the Collection dir
 * (see {@link resourcePolicyFileName}). The Space and Collection names are
 * fixed (an id is not needed to find the one entity a directory belongs to),
 * and the fixed names are what makes the Resource form collision-free: a
 * Resource id is never empty, so `.r.<resourceId>.policy.json` can equal
 * neither of them.
 */
export const POLICY_FILE_SUFFIX = '.policy.json'

/**
 * File name of a Space's own access-control policy, in the Space dir.
 */
export const SPACE_POLICY_FILE_NAME = '.space.policy.json'

/**
 * File name of a Collection's own access-control policy, in the Collection
 * dir. Starts with the Collection description's `.collection.` prefix, so any
 * classifier that matches that prefix must test for this exact name first.
 */
export const COLLECTION_POLICY_FILE_NAME = '.collection.policy.json'

/**
 * Prefix of a Resource's access-control policy dot-file
 * (`.r.<resourceId>.policy.json`). The leading `.` keeps it out of the
 * `r.`-prefixed representation listing; the `r` marks the level.
 */
export const RESOURCE_POLICY_FILE_PREFIX = '.r.'

/**
 * Prefix of a Resource metadata sidecar (`.meta.<resourceId>.json`) -- and,
 * inside a chunk directory, of a chunk's version sidecar (`.meta.<index>.json`).
 */
export const META_FILE_PREFIX = '.meta.'

/**
 * Prefix of a Collection's governing history log file
 * (`.collectionlog.<collectionId>.json`, the `governed-history-logs` feature):
 * the JSON Lines log body with its own `ETag` validator, kept beside the
 * Collection's metadata file. Its own prefix, disjoint from `.meta.`, keeps it
 * out of the Resource listing, the `changes` feed's tombstone scan, and the
 * metadata import branches.
 */
export const COLLECTION_LOG_FILE_PREFIX = '.collectionlog.'

/**
 * The Space id the layout reserves: its Space Metadata file name would be
 * `.space.policy.json`, which is the Space's policy file
 * ({@link SPACE_POLICY_FILE_NAME}).
 */
export const RESERVED_SPACE_ID = 'policy'

/**
 * Refuses the reserved Space id ({@link RESERVED_SPACE_ID}) on the writing
 * side: the file-name builder and the packer both name a Space through here.
 * @param spaceId {string}
 * @returns {void}
 */
export function assertSpaceIdNotReserved(spaceId: string): void {
  if (spaceId === RESERVED_SPACE_ID) {
    throw new Error(
      `The Space id "${RESERVED_SPACE_ID}" is reserved: its Metadata file name would be the Space policy file's.`
    )
  }
}

/**
 * Builds the file name of a Space Metadata object's file:
 * `.space.<spaceId>.json`. Refuses the reserved Space id
 * ({@link RESERVED_SPACE_ID}).
 * @param spaceId {string}
 * @returns {string}
 */
export function spaceMetadataFileName(spaceId: string): string {
  assertSpaceIdNotReserved(spaceId)
  return `${SPACE_FILE_PREFIX}${spaceId}${JSON_FILE_SUFFIX}`
}

/**
 * Builds the file name of a Collection Metadata object's file:
 * `.collection.<collectionId>.json`. The one file holds the whole merged
 * object: the configuration members beside `createdAt`, `updatedAt`,
 * `custom`, and `epoch`.
 * @param collectionId {string}
 * @returns {string}
 */
export function collectionMetadataFileName(collectionId: string): string {
  return `${COLLECTION_FILE_PREFIX}${collectionId}${JSON_FILE_SUFFIX}`
}

/**
 * Builds the file name of a Resource's access-control policy document:
 * `.r.<resourceId>.policy.json`, kept in the Collection dir alongside the
 * Resource's representation and metadata sidecar. The id is not dot-escaped:
 * the prefix and suffix are both fixed, so {@link parseResourcePolicyFileName}
 * recovers a dotted id by slicing rather than splitting.
 * @param resourceId {string}
 * @returns {string}
 */
export function resourcePolicyFileName(resourceId: string): string {
  return `${RESOURCE_POLICY_FILE_PREFIX}${resourceId}${POLICY_FILE_SUFFIX}`
}

/**
 * Parses a Resource policy file name (`.r.<resourceId>.policy.json`) back into
 * its `resourceId`, reversing {@link resourcePolicyFileName}. Returns
 * `undefined` when the name is not a Resource policy file (no matching prefix
 * or suffix, or an empty id).
 * @param fileName {string}   the basename of the file
 * @returns {string | undefined}
 */
export function parseResourcePolicyFileName(
  fileName: string
): string | undefined {
  return parseAffixedFileName({
    fileName,
    prefix: RESOURCE_POLICY_FILE_PREFIX,
    suffix: POLICY_FILE_SUFFIX
  })
}

/**
 * True when `fileName` is one of the three access-control policy dot-files.
 * Tested by exact name or by the Resource form's fixed prefix and suffix, not
 * by the `.policy.json` suffix alone: a metadata sidecar of a Resource whose
 * id ends in `.policy` (`.meta.<id>.policy.json`) carries that suffix too.
 * @param fileName {string}
 * @returns {boolean}
 */
export function isPolicyFileName(fileName: string): boolean {
  return (
    fileName === SPACE_POLICY_FILE_NAME ||
    fileName === COLLECTION_POLICY_FILE_NAME ||
    parseResourcePolicyFileName(fileName) !== undefined
  )
}

/**
 * Builds the file name of a Resource's metadata sidecar:
 * `.meta.<resourceId>.json`. A dot-file kept alongside the resource
 * representation in the Collection dir (the same convention as the policy and
 * `.collection.` dot-files), holding the timestamps and user-writable `custom`
 * object.
 * Inside a chunk directory the same builder names a chunk's version sidecar,
 * keyed by the stringified chunk index.
 * @param resourceId {string}
 * @returns {string}
 */
export function metaSidecarFileName(resourceId: string): string {
  return `${META_FILE_PREFIX}${resourceId}${JSON_FILE_SUFFIX}`
}

/**
 * Builds the file name of a Collection's governing history log:
 * `.collectionlog.<collectionId>.json`, a dot-file in the Collection dir
 * beside the Collection Metadata file, versioned independently of it.
 * @param collectionId {string}
 * @returns {string}
 */
export function collectionLogFileName(collectionId: string): string {
  return `${COLLECTION_LOG_FILE_PREFIX}${collectionId}${JSON_FILE_SUFFIX}`
}

/**
 * Parses a fixed-prefix, fixed-suffix dot-file name back into its id segment,
 * the shared slicing this module's dot-file parsers apply. The id is not dot-escaped
 * in these names, so it is recovered by slicing rather than splitting, and a
 * dotted id survives. Returns `undefined` when the name does not carry both
 * affixes or the id segment is empty.
 * @param options {object}
 * @param options.fileName {string}
 * @param options.prefix {string}
 * @param options.suffix {string}
 * @returns {string | undefined}
 */
function parseAffixedFileName({
  fileName,
  prefix,
  suffix
}: {
  fileName: string
  prefix: string
  suffix: string
}): string | undefined {
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return undefined
  }
  const id = fileName.slice(prefix.length, -suffix.length)
  return id.length > 0 ? id : undefined
}

/**
 * Parses a Space Metadata file name (`.space.<spaceId>.json`) back into its
 * `spaceId`, reversing {@link spaceMetadataFileName}. The Space's own policy
 * file shares the `.space.` prefix, so it is excluded by name first.
 * @param fileName {string}
 * @returns {string | undefined}
 */
export function parseSpaceMetadataFileName(
  fileName: string
): string | undefined {
  if (fileName === SPACE_POLICY_FILE_NAME) {
    return undefined
  }
  return parseAffixedFileName({
    fileName,
    prefix: SPACE_FILE_PREFIX,
    suffix: JSON_FILE_SUFFIX
  })
}

/**
 * Parses a Collection Metadata file name (`.collection.<collectionId>.json`)
 * back into its `collectionId`, reversing
 * {@link collectionMetadataFileName}. The Collection's own policy file shares
 * the `.collection.` prefix, so it is excluded by name first.
 * @param fileName {string}
 * @returns {string | undefined}
 */
export function parseCollectionMetadataFileName(
  fileName: string
): string | undefined {
  if (fileName === COLLECTION_POLICY_FILE_NAME) {
    return undefined
  }
  return parseAffixedFileName({
    fileName,
    prefix: COLLECTION_FILE_PREFIX,
    suffix: JSON_FILE_SUFFIX
  })
}

/**
 * Parses a Collection governing history log file name
 * (`.collectionlog.<collectionId>.json`) back into its `collectionId`,
 * reversing {@link collectionLogFileName}.
 * @param fileName {string}
 * @returns {string | undefined}
 */
export function parseCollectionLogFileName(
  fileName: string
): string | undefined {
  return parseAffixedFileName({
    fileName,
    prefix: COLLECTION_LOG_FILE_PREFIX,
    suffix: JSON_FILE_SUFFIX
  })
}

/**
 * Parses a Resource metadata sidecar file name (`.meta.<resourceId>.json`)
 * back into its `resourceId`, reversing {@link metaSidecarFileName}. Inside a
 * chunk directory the same name carries a chunk index instead, which the
 * caller reads with {@link parseChunkIndexSegment}.
 * @param fileName {string}
 * @returns {string | undefined}
 */
export function parseMetaSidecarFileName(fileName: string): string | undefined {
  return parseAffixedFileName({
    fileName,
    prefix: META_FILE_PREFIX,
    suffix: JSON_FILE_SUFFIX
  })
}

/**
 * What one file name inside a Collection directory holds. The kinds are the
 * ones the file-name codec builds, read back through its own parsers.
 */
export type CollectionFileKind =
  | { kind: 'representation'; resourceId: string; contentType: string }
  | { kind: 'spaceMetadata'; spaceId: string }
  | { kind: 'collectionMetadata'; collectionId: string }
  | { kind: 'collectionLog'; collectionId: string }
  | { kind: 'metaSidecar'; resourceId: string }
  | { kind: 'policy'; scope: 'space' | 'collection' }
  | { kind: 'resourcePolicy'; resourceId: string }
  | { kind: 'chunkDirectory'; resourceId: string }
  | { kind: 'other' }

/**
 * Classifies one file name inside a Space or Collection directory, for the
 * archive reader and the manifest builder alike. The two fixed policy names are
 * tested before the prefixes they share with the Metadata dot-files, so
 * `.collection.policy.json` is never read as a Collection Metadata file.
 * @param fileName {string}   the entry's basename
 * @returns {CollectionFileKind}
 */
export function classifyCollectionFile(fileName: string): CollectionFileKind {
  if (fileName === SPACE_POLICY_FILE_NAME) {
    return { kind: 'policy', scope: 'space' }
  }
  if (fileName === COLLECTION_POLICY_FILE_NAME) {
    return { kind: 'policy', scope: 'collection' }
  }
  const policyResourceId = parseResourcePolicyFileName(fileName)
  if (policyResourceId !== undefined) {
    return { kind: 'resourcePolicy', resourceId: policyResourceId }
  }
  const spaceId = parseSpaceMetadataFileName(fileName)
  if (spaceId !== undefined) {
    return { kind: 'spaceMetadata', spaceId }
  }
  const collectionId = parseCollectionMetadataFileName(fileName)
  if (collectionId !== undefined) {
    return { kind: 'collectionMetadata', collectionId }
  }
  const logCollectionId = parseCollectionLogFileName(fileName)
  if (logCollectionId !== undefined) {
    return { kind: 'collectionLog', collectionId: logCollectionId }
  }
  const metaResourceId = parseMetaSidecarFileName(fileName)
  if (metaResourceId !== undefined) {
    return { kind: 'metaSidecar', resourceId: metaResourceId }
  }
  const chunkResourceId = parseChunkDirName(fileName)
  if (chunkResourceId !== undefined) {
    return { kind: 'chunkDirectory', resourceId: chunkResourceId }
  }
  if (isRepresentationFileName(fileName)) {
    const { resourceId, contentType } = parseResourceFileName(fileName)
    // No id means the name did not parse (a missing or malformed id segment),
    // so there is no Resource to read it as.
    if (resourceId !== '') {
      return { kind: 'representation', resourceId, contentType }
    }
  }
  return { kind: 'other' }
}
