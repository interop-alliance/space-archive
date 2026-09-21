/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * `@interop/space-archive`: the per-Space archive codec for Wallet Attached
 * Storage Space exports. One door onto the file-name codec, the manifest, the
 * packer and the reader (`./archive`), plus the byte-source adapter and the
 * lazy tar walk they and their consumers share.
 */
// The file-name dialect, the archive path grammar, and the manifest URLs are
// public in full.
export * from './archive/resourceFileName.js'
export * from './archive/archivePath.js'
export * from './archive/manifestUrls.js'

export {
  buildExportManifest,
  EXPORT_ENTRY_MTIME
} from './archive/exportManifest.js'
export type { ExportSpaceEntry } from './archive/exportManifest.js'

export { packSpaceArchive } from './archive/exportTar.js'
export type {
  ArchiveDirectory,
  ArchiveEntry,
  ArchiveFile
} from './archive/exportTar.js'

export {
  parseArchiveManifest,
  readSpaceArchive
} from './archive/readSpaceArchive.js'
export type {
  SpaceArchive,
  SpaceArchiveManifest
} from './archive/readSpaceArchive.js'

export { byteChunks, collectBytes } from './stream.js'
export type { ByteSource } from './stream.js'

export { tarEntries } from './tarEntries.js'
export type { TarEntry } from './tarEntries.js'

export { BundleInvalidError } from './errors.js'
