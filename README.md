# Space Archive _(@interop/space-archive)_

[![Node.js CI](https://github.com/interop-alliance/space-archive/workflows/CI/badge.svg)](https://github.com/interop-alliance/space-archive/actions?query=workflow%3A%22CI%22)
[![NPM Version](https://img.shields.io/npm/v/@interop/space-archive.svg)](https://npm.im/@interop/space-archive)

> Per-Space archive codec for Wallet Attached Storage Space exports: file-name
> codec, manifest, packer, reader.

Reads and writes the per-Space export archive a Wallet Attached Storage server
writes: one tar per Space, carrying a `manifest.yml`, the Space's metadata, its
Collections, and their Resources under a fixed file-name dialect. Isomorphic
(browser, Node.js, React Native) and offline -- bytes in, bytes out, no HTTP.

## Table of Contents

- [Background](#background)
- [Security](#security)
- [Install](#install)
- [Usage](#usage)
- [Exports](#exports)
- [Contribute](#contribute)
- [License](#license)

## Background

This package is the one implementation of the per-Space archive layout: the file
names, the `manifest.yml` shape, and the pack order. It was moved out of
`@interop/wallet-backup`, where it started, once the WAS reference server needed
the codec without the rest of that package's dependency tree (the backup bundle
codec and the migration walk, which stay in `wallet-backup` and consume this
package).

## Security

TBD

## Install

- Node.js 24+ is recommended.

### PNPM

To install via PNPM:

```
pnpm install @interop/space-archive
```

### Development

To install locally (for development):

```
git clone https://github.com/interop-alliance/space-archive.git
cd space-archive
pnpm install
```

## Usage

### Packing a Space archive

```js
import { packSpaceArchive, collectBytes } from '@interop/space-archive'

const pack = await packSpaceArchive({
  spaceId: 'zMySpace',
  entries: [
    {
      name: '.space.zMySpace.json',
      bytes: new TextEncoder().encode('{"id":"zMySpace"}')
    }
  ]
})
const archiveBytes = await collectBytes(pack)
```

`entries` is a tree of `ArchiveFile` and `ArchiveDirectory` nodes; a chunked
Resource's directory of chunk files is the one nesting the dialect allows. A
file's bytes can be given inline or read lazily through a `read()` thunk, so a
large export packs one file at a time rather than holding the whole tree in
memory: `packSpaceArchive` returns the pack before filling it, and each entry
waits for the consumer to read it out before the next one is written. A `read()`
thunk that rejects fails the pack's reader, not the `packSpaceArchive` call
itself.

`service` is optional: the exporting server's Service Description, written
verbatim as the archive's `service.json` immediately after `manifest.yml`. An
archive carrying one says which specification versions and feature set its
contents were written under. Nothing in this package checks it.

`provenance` and `didLog` are optional too, each a `Uint8Array` or a string.
They are the exporting server's signed provenance statements (one JSON object
per line) and the history log of the DID that signed them. They are written
verbatim as `provenance.jsonl` and `did.jsonl`, after `service.json`, and both
are listed in the manifest. This package neither signs nor verifies them.

`packSpaceArchive` refuses the Space id `policy` (`RESERVED_SPACE_ID`), since
its Space Metadata file name would collide with the Space's own policy file. It
likewise refuses a top-level Collection directory named `policy`
(`RESERVED_COLLECTION_ID`), and `collectionMetadataFileName('policy')` throws,
since the Collection Metadata file name would be the Collection policy file's.

A deleted Collection is packed as a Collection tombstone: a top-level entry
named `.collection.<collectionId>.json` whose body is the stored tombstone
(`deleted: true`, the whole write stamp, `_generation`, and no other member),
with no Collection directory of that id. The manifest lists it with
`deleted: true`. The packer refuses a tombstone body that
`collectionTombstoneFromFile` refuses (no write stamp, or live Metadata members
kept), a `deleted: true` body inside a Collection directory, and a tombstone
beside a Collection directory of the same id.

In the manifest, that entry is a file in a Space's `contents`, a single-key
object, where every other object entry is a Collection directory. Tell a
directory by its `contents` member, or a tombstone by `deleted: true`.

```js
const pack = await packSpaceArchive({
  spaceId: 'zMySpace',
  entries: [
    {
      name: '.collection.oldNotes.json',
      bytes: new TextEncoder().encode(
        JSON.stringify({
          deleted: true,
          updatedAt: '2026-10-03T00:00:00.000Z',
          updatedAtCounter: 0,
          originId: 'zOrigin',
          _generation: 'zGeneration'
        })
      )
    }
  ]
})
```

### Reading a Space archive

```js
import { readSpaceArchive } from '@interop/space-archive'

const space = await readSpaceArchive(archiveBytes) // Uint8Array, stream, or async iterable

space.spaceId // 'zMySpace'
space.manifest // the parsed manifest.yml document
space.service // the exporting server's Service Description, or undefined
space.provenance // the provenance.jsonl bytes, unverified, or undefined
space.didLog // the did.jsonl bytes, unverified, or undefined

for await (const entry of space.entries) {
  entry.name // e.g. 'space/zMySpace/collection.notes/...'
  const bytes = await entry.bytes()
}
```

The reader parses the manifest from the first tar entry, reads `service.json`,
`provenance.jsonl` and `did.jsonl` when the archive carries them (the entries
after it, in that order), and then walks the rest lazily: at most one Space
archive is held in memory at a time, and the walk is one-shot -- iterate it
once, and call each entry's `bytes()` once before moving to the next. A second
call to `bytes()`, or one made after the walk has moved past that entry,
rejects. Bytes that are not a tar, or a truncated archive, are refused with a
`BundleInvalidError`. A caller that opens an archive and never iterates
`entries` calls `space.close()` to release the underlying source.

A Metadata file stores its object with its generation embedded as the reserved
`_generation` member. The write stamp (`updatedAt`, `updatedAtCounter`,
`originId`) is part of the object. `collectionMetadataFromFile({ bytes })` and
`spaceMetadataFromFile({ bytes })` read one back without `_generation`:

```js
import {
  classifyCollectionFile,
  collectionMetadataFromFile
} from '@interop/space-archive'

if (classifyCollectionFile(fileName).kind === 'collectionMetadata') {
  const metadata = collectionMetadataFromFile({ bytes: await entry.bytes() })
  metadata.generator // the app the Collection was provisioned for, if any
}
```

A Collection tombstone's path parses as the `collectionTombstone` area, and
`collectionTombstoneFromFile({ bytes })` reads its body without `_generation`.
It requires `deleted: true`, a whole write stamp, and no other member, and
returns `WriteStamp & { deleted: true }`. `collectionMetadataFromFile` refuses a
tombstone body, and `isCollectionTombstone(metadata)` tells a parsed body that
is one. The walk refuses an archive holding one Collection both as a tombstone
and as a directory. The check is per Space directory, and only a file entry
counts as a tombstone.

```js
import {
  collectionTombstoneFromFile,
  parseArchivePath
} from '@interop/space-archive'

const position = parseArchivePath(entry.name)
if (position.area === 'collectionTombstone') {
  const tombstone = collectionTombstoneFromFile({ bytes: await entry.bytes() })
  position.collectionId // the deleted Collection's id
  tombstone.updatedAt // the deleting write's stamp
}
```

`collectionGeneratorFromMetadata(metadata)` returns that `generator` when it is
well formed, and `undefined` otherwise. `policyFromFile({ bytes })` reads a
policy file into its policy document, such as `{ type: 'PublicCanRead' }`.

## Exports

The package's root export is documented in [ARCHITECTURE.md](ARCHITECTURE.md);
in short: the archive codec (`packSpaceArchive`, `readSpaceArchive`, the
manifest, file-name, Metadata file, and policy file helpers), the
`BundleInvalidError` the reader raises on a malformed archive, and the
byte-source (`ByteSource`, `byteChunks`, `collectBytes`) and tar-walk
(`tarEntries`, `TarEntry`) helpers a caller needs to build or consume a
`ByteSource`.

## Contribute

PRs accepted. See [CONTRIBUTING.md](CONTRIBUTING.md) for editor setup (Prettier,
ESLint, and EditorConfig) and how it maps to CI.

If editing the Readme, please conform to the
[standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

[MIT License](LICENSE.md) © 2026 Interop Alliance.
