/**
 * Packer for a Space export archive: turns an ordered entry tree into the UBC
 * v0.1 tarball (`manifest.yml`, the exporting server's `service.json` where it
 * has one, its `provenance.jsonl` and `did.jsonl` where it signed the export,
 * the `space/<spaceId>/` tree, and the top-level `revocations/` block). Every
 * caller describes the same archive dialect (the file names built by
 * `resourceFileName.ts`, positioned by the path grammar in `archivePath.ts`),
 * whatever storage it reads from, so an archive exported by one imports into
 * another. This module is the single home for the packing itself, and it
 * derives the manifest from the very tree it packs so the two can never drift
 * apart. Before a pack is created, `packSpaceArchive` walks
 * the caller's tree through `archivePath.ts`'s `buildArchivePath`, refusing a
 * shape the reader's `parseArchivePath` could not place.
 *
 * Byte acquisition is the only thing that differs per caller, so a file entry
 * either carries its `bytes` inline (small JSON dot-files) or a `read()` thunk
 * called at pack time (a Resource representation or a chunk, fetched one at a
 * time so an export never holds a whole Space in memory). The pack is handed
 * back before it is filled, and each entry waits for the one before it to be
 * read out, so the consumer's pace is the packer's. Entry ORDER is the
 * caller's: the packer walks the tree exactly as given.
 */
import * as tar from 'tar-stream'
import YAML from 'yaml'
import {
  buildArchivePath,
  parseArchivePath,
  ARCHIVE_DID_LOG_FILE,
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_PROVENANCE_FILE,
  ARCHIVE_REVOCATIONS_DIR,
  ARCHIVE_SERVICE_FILE,
  ARCHIVE_SPACE_DIR
} from './archivePath.js'
import type { ArchivePath } from './archivePath.js'
import { CollectionForms } from './collectionForms.js'
import { buildExportManifest, EXPORT_ENTRY_MTIME } from './exportManifest.js'
import {
  collectionTombstoneFromFile,
  holdsCollectionTombstone
} from './metadataFile.js'
import {
  assertCollectionIdNotReserved,
  assertSpaceIdNotReserved,
  classifyCollectionFile
} from './resourceFileName.js'

/**
 * One file in an export archive: its bytes inline, or a `read()` thunk resolved
 * at pack time. The bytes are a `Uint8Array` rather than a Node `Buffer`, so
 * the packer runs unchanged in a browser; a `Buffer` is a `Uint8Array` and is
 * still accepted by a Node caller.
 */
export type ArchiveFile = { name: string } & (
  { bytes: Uint8Array } | { read: () => Promise<Uint8Array> }
)

/**
 * One directory in an export archive (a Collection dir, or a Resource's
 * `.chunks.<encId>/` subdirectory), holding its entries in archive order.
 */
export interface ArchiveDirectory {
  name: string
  files: ArchiveEntry[]
}

/**
 * Either kind of archive entry, at any level of the tree.
 */
export type ArchiveEntry = ArchiveFile | ArchiveDirectory

/**
 * True when `entry` is a directory, the one test that tells the two entry
 * kinds apart.
 * @param entry {ArchiveEntry}
 * @returns {boolean}
 */
function isArchiveDirectory(entry: ArchiveEntry): entry is ArchiveDirectory {
  return 'files' in entry
}

/**
 * Walks an entry tree in archive order: each entry with its path relative to
 * the tree's root, a directory ahead of its children. The one definition of
 * tree order, which the manifest's names and the pack's entries both follow.
 * @param entries {ArchiveEntry[]}
 * @param [parentPath] {string}   the path of the directory holding `entries`
 * @returns {Generator<{ path: string, entry: ArchiveEntry, parentPath?: string }>}
 */
function* walkEntries(
  entries: ArchiveEntry[],
  parentPath?: string
): Generator<{ path: string; entry: ArchiveEntry; parentPath?: string }> {
  for (const entry of entries) {
    const path =
      parentPath === undefined ? entry.name : `${parentPath}/${entry.name}`
    yield { path, entry, parentPath }
    if (isArchiveDirectory(entry)) {
      yield* walkEntries(entry.files, path)
    }
  }
}

/**
 * Adds one entry to the pack and waits until the consumer has read it out.
 * Awaiting each entry is what bounds the packer's memory: tar-stream queues an
 * entry's whole body when nothing waits on it.
 * @param options {object}
 * @param options.pack {tar.Pack}
 * @param options.header {tar.Header}
 * @param [options.body] {Uint8Array | string}   absent for a directory entry
 * @returns {Promise<void>}
 */
async function packEntry({
  pack,
  header,
  body
}: {
  pack: tar.Pack
  header: Partial<tar.Header> & { name: string }
  body?: Uint8Array | string
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function settle(err?: Error | null): void {
      if (err) {
        reject(err)
        return
      }
      resolve()
    }
    if (body === undefined) {
      pack.entry(header, settle)
      return
    }
    pack.entry(header, body, settle)
  })
}

/**
 * Flattens a directory's entries into the relative paths the manifest lists,
 * in tree order: a nested directory (a chunk directory) expands to its
 * `<dirName>/<fileName>` children, mirroring the pack order below.
 * @param entries {ArchiveEntry[]}
 * @returns {string[]}
 */
function flattenEntryNames(entries: ArchiveEntry[]): string[] {
  const names: string[] = []
  for (const { path, entry } of walkEntries(entries)) {
    if (!isArchiveDirectory(entry)) {
      names.push(path)
    }
  }
  return names
}

/**
 * Packs one directory: its own directory entry, then everything under it in
 * tree order (a nested chunk directory's entry ahead of its chunk files).
 * @param options {object}
 * @param options.pack {tar.Pack}
 * @param options.target {string}   the directory's archive path (no trailing slash)
 * @param options.entries {ArchiveEntry[]}
 * @returns {Promise<void>}
 */
async function packDirectory({
  pack,
  target,
  entries
}: {
  pack: tar.Pack
  target: string
  entries: ArchiveEntry[]
}): Promise<void> {
  const mtime = EXPORT_ENTRY_MTIME
  await packEntry({
    pack,
    header: { name: `${target}/`, type: 'directory', mtime }
  })
  for (const { path, entry } of walkEntries(entries)) {
    if (isArchiveDirectory(entry)) {
      await packEntry({
        pack,
        header: { name: `${target}/${path}/`, type: 'directory', mtime }
      })
      continue
    }
    const name = `${target}/${path}`
    let body: Uint8Array
    if ('bytes' in entry) {
      // Inline bytes were checked before the pack was created.
      body = entry.bytes
    } else {
      // A `read()` thunk is called only now, one file at a time.
      body = await entry.read()
      assertBodyFitsPosition({
        path: name,
        position: parseArchivePath(name),
        body
      })
    }
    await packEntry({ pack, header: { name, mtime }, body })
  }
}

/**
 * Refuses a Collection Metadata file whose body disagrees with its position.
 * A Collection tombstone (a `.collection.<collectionId>.json` file in the
 * Space directory) must read as one through `collectionTombstoneFromFile`:
 * `deleted: true`, a whole write stamp, `_generation`, and no other member. A
 * Collection Metadata file inside its Collection directory must not carry
 * `deleted: true`; a body there that is not a JSON object passes, as it does
 * for every other file. Every other file passes unread.
 * @param options {object}
 * @param options.path {string}   the file's archive path
 * @param options.position {ArchivePath}   that path, parsed
 * @param options.body {Uint8Array}
 * @returns {void}
 */
function assertBodyFitsPosition({
  path,
  position,
  body
}: {
  path: string
  position: ArchivePath
  body: Uint8Array
}): void {
  if (position.area === 'collectionTombstone') {
    try {
      collectionTombstoneFromFile({ bytes: body })
    } catch (err) {
      throw new Error(
        `The Collection tombstone "${path}" is not a tombstone body.`,
        { cause: err }
      )
    }
    return
  }
  if (
    position.area === 'collection' &&
    classifyCollectionFile(position.fileName).kind === 'collectionMetadata' &&
    holdsCollectionTombstone({ bytes: body })
  ) {
    throw new Error(
      `The Collection Metadata file "${path}" is a tombstone inside its Collection directory. A Collection tombstone is packed in the Space directory, with no Collection directory.`
    )
  }
}

/**
 * Refuses an entry tree containing a shape {@link buildArchivePath} cannot
 * place: an entry name that is empty or embeds a `/`, a directory nested
 * deeper than a chunk directory, or a directory that is not a chunk directory
 * where the layout allows no other kind of directory. Also refuses a
 * Collection directory named by the reserved Collection id, a Collection
 * packed both as a tombstone and as a Collection directory (a tombstone has
 * no member entries), and a file whose inline bytes disagree with its
 * position (see {@link assertBodyFitsPosition}). Walks the tree in the same order
 * `packDirectory` packs it, before a pack ever exists, so a caller sees the
 * refusal without any tar-stream side effect.
 * @param options {object}
 * @param options.rootPath {string}   the directory holding `entries`, as an
 *   archive path (no trailing slash)
 * @param options.entries {ArchiveEntry[]}
 * @returns {void}
 */
function assertEntriesPlaceable({
  rootPath,
  entries
}: {
  rootPath: string
  entries: ArchiveEntry[]
}): void {
  const forms = new CollectionForms()
  for (const { parentPath, entry } of walkEntries(entries, rootPath)) {
    const isDirectory = isArchiveDirectory(entry)
    const path = buildArchivePath({
      parentPath,
      name: entry.name,
      isDirectory
    })
    const position = parseArchivePath(isDirectory ? `${path}/` : path)
    if (isDirectory && position.area === 'collection') {
      assertCollectionIdNotReserved(position.collectionId)
    }
    const conflict = forms.conflictAt({ position, isFile: !isDirectory })
    if (conflict !== undefined) {
      throw new Error(
        `The Collection "${conflict}" is packed both as a tombstone and as a Collection directory.`
      )
    }
    if ('bytes' in entry) {
      assertBodyFitsPosition({ path, position, body: entry.bytes })
    }
  }
}

/**
 * Serializes the exporting server's Service Description for the
 * `service.json` entry. Refuses a value JSON cannot represent (a circular
 * reference, a BigInt, a function, a `toJSON` yielding nothing), so the
 * refusal lands before any pack is created and an export cannot silently omit
 * the entry.
 * @param service {object}
 * @returns {string}
 */
function serializeServiceDescription(service: object): string {
  const message = `The Service Description cannot be serialized as "${ARCHIVE_SERVICE_FILE}".`
  let text: string | undefined
  try {
    text = JSON.stringify(service)
  } catch (err) {
    throw new Error(message, { cause: err })
  }
  if (typeof text !== 'string') {
    throw new Error(message)
  }
  return text
}

/**
 * Fills a Space archive's pack in archive order and finalizes it. A failure (a
 * `read()` thunk that rejects) destroys the pack, which is where the consumer
 * reading it sees the failure.
 * @param options {object}
 * @param options.pack {tar.Pack}
 * @param options.manifestText {string}
 * @param options.rootFiles {object[]}   the root entries written right after
 *   the manifest, in order (`service.json`, `provenance.jsonl`, `did.jsonl`);
 *   one whose `body` is `undefined` is not written
 * @param options.spaceDirPath {string}   the `space/<spaceId>` directory's
 *   archive path
 * @param options.entries {ArchiveEntry[]}
 * @param options.revocations {ArchiveFile[]}
 * @returns {Promise<void>}
 */
async function fillSpaceArchive({
  pack,
  manifestText,
  rootFiles,
  spaceDirPath,
  entries,
  revocations
}: {
  pack: tar.Pack
  manifestText: string
  rootFiles: { name: string; body: Uint8Array | string | undefined }[]
  spaceDirPath: string
  entries: ArchiveEntry[]
  revocations: ArchiveFile[]
}): Promise<void> {
  // Fixed mtime on every entry so the archive is byte-reproducible (see
  // EXPORT_ENTRY_MTIME).
  const mtime = EXPORT_ENTRY_MTIME
  try {
    await packEntry({
      pack,
      header: { name: ARCHIVE_MANIFEST_FILE, mtime },
      body: manifestText
    })
    for (const { name, body } of rootFiles) {
      if (body !== undefined) {
        await packEntry({ pack, header: { name, mtime }, body })
      }
    }
    await packEntry({
      pack,
      header: { name: `${ARCHIVE_SPACE_DIR}/`, type: 'directory', mtime }
    })
    await packDirectory({
      pack,
      target: spaceDirPath,
      entries
    })

    if (revocations.length > 0) {
      await packDirectory({
        pack,
        target: ARCHIVE_REVOCATIONS_DIR,
        entries: revocations
      })
    }

    pack.finalize()
  } catch (err) {
    pack.destroy(err as Error)
  }
}

/**
 * Packs a Space export archive from the caller's ordered entry tree: the
 * `manifest.yml` describing it, the exporting server's Service Description as
 * `service.json` when one is given, the `provenance.jsonl` and `did.jsonl`
 * bodies when given, the `space/` and `space/<spaceId>/` directory
 * entries, every top-level entry (a Space-level file, or a Collection directory
 * with its files and chunk directories), then the Space-scoped zcap revocations
 * under a top-level `revocations/` dir. Refuses the reserved Space id, and
 * refuses -- before any pack is created -- an entry tree containing a shape
 * `parseArchivePath` could not place: a directory nested deeper than a chunk
 * directory, a directory that is not a chunk directory nested inside a
 * Collection directory, a directory inside a chunk directory, or an entry name
 * that is empty or embeds a `/`.
 *
 * A Collection tombstone is a top-level file named
 * `.collection.<collectionId>.json` whose body carries `deleted: true`, a
 * whole write stamp, `_generation`, and no other member, with no Collection
 * directory of that id. The manifest lists it with `deleted: true`, derived
 * from its position. The packer refuses a tombstone beside a Collection
 * directory of the same id, a body in the tombstone position that is not a
 * tombstone, and a `deleted: true` body inside a Collection directory. It
 * also refuses a Collection directory named `policy`
 * (`RESERVED_COLLECTION_ID`).
 * Inline bytes are checked before any pack is created; a body read through a
 * `read()` thunk is checked when it is read, and a refusal then fails the
 * pack's reader.
 * @param options {object}
 * @param options.spaceId {string}
 * @param options.entries {ArchiveEntry[]}   the Space's top-level entries, in
 *   the order they are packed (the manifest mirrors it)
 * @param [options.revocations] {ArchiveFile[]}   the Space's zcap revocation
 *   records; no `revocations/` block is emitted when there are none
 * @param [options.service] {object}   the exporting server's Service
 *   Description, written verbatim as the `service.json` entry immediately
 *   after the manifest; no such entry is written when it is absent
 * @param [options.provenance] {Uint8Array | string}   the exporting server's
 *   provenance statements, one per line, written verbatim as the
 *   `provenance.jsonl` entry after `service.json` and listed in the manifest;
 *   no such entry is written when it is absent
 * @param [options.didLog] {Uint8Array | string}   the exporting server's DID
 *   history log snapshot, written verbatim as the `did.jsonl` entry after
 *   `provenance.jsonl` and listed in the manifest; no such entry is written
 *   when it is absent
 * @returns {Promise<tar.Pack & AsyncIterable<Uint8Array>>}   the tar-stream
 *   pack (a streamx readable; a Node caller wraps it with `Readable.from`),
 *   filled as it is read. A
 *   `read()` thunk that rejects fails the pack's reader, not this call.
 */
export async function packSpaceArchive({
  spaceId,
  entries,
  revocations = [],
  service,
  provenance,
  didLog
}: {
  spaceId: string
  entries: ArchiveEntry[]
  revocations?: ArchiveFile[]
  service?: object
  provenance?: Uint8Array | string
  didLog?: Uint8Array | string
}): Promise<tar.Pack & AsyncIterable<Uint8Array>> {
  assertSpaceIdNotReserved(spaceId)
  const spaceDirPath = buildArchivePath({
    parentPath: ARCHIVE_SPACE_DIR,
    name: spaceId,
    isDirectory: true
  })
  assertEntriesPlaceable({ rootPath: spaceDirPath, entries })
  if (revocations.length > 0) {
    assertEntriesPlaceable({
      rootPath: ARCHIVE_REVOCATIONS_DIR,
      entries: revocations
    })
  }
  // Serialized here, and only here, so two exports of one Service
  // Description are the same bytes.
  const serviceText =
    service === undefined ? undefined : serializeServiceDescription(service)
  const manifest = buildExportManifest({
    spaceId,
    entries: entries.map(entry =>
      isArchiveDirectory(entry)
        ? { name: entry.name, files: flattenEntryNames(entry.files) }
        : { name: entry.name }
    ),
    revocationFiles: revocations.map(file => file.name),
    provenance: provenance !== undefined,
    didLog: didLog !== undefined
  })

  const pack = tar.pack()
  // Not awaited: the pack fills as the consumer reads it, and a failure while
  // filling reaches the consumer by destroying the pack.
  void fillSpaceArchive({
    pack,
    manifestText: YAML.stringify(manifest),
    // Provenance and the DID log are carried verbatim, unverified: checking
    // them is the reader's business.
    rootFiles: [
      { name: ARCHIVE_SERVICE_FILE, body: serviceText },
      { name: ARCHIVE_PROVENANCE_FILE, body: provenance },
      { name: ARCHIVE_DID_LOG_FILE, body: didLog }
    ],
    spaceDirPath,
    entries,
    revocations
  })
  // tar-stream's pack is a streamx stream, which is async-iterable and needs
  // no Node `stream` import; a Node caller that wants a `Readable` wraps it.
  // Its typings iterate `unknown`, so the byte type is stated once here.
  return pack as tar.Pack & AsyncIterable<Uint8Array>
}
