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

`packSpaceArchive` refuses the Space id `policy` (`RESERVED_SPACE_ID`), since
its Space Metadata file name would collide with the Space's own policy file.

### Reading a Space archive

```js
import { readSpaceArchive } from '@interop/space-archive'

const space = await readSpaceArchive(archiveBytes) // Uint8Array, stream, or async iterable

space.spaceId // 'zMySpace'
space.manifest // the parsed manifest.yml document
space.service // the exporting server's Service Description, or undefined

for await (const entry of space.entries) {
  entry.name // e.g. 'space/zMySpace/collection.notes/...'
  const bytes = await entry.bytes()
}
```

The reader parses the manifest from the first tar entry, reads `service.json`
when the archive carries one (the entry after it), and then walks the rest
lazily: at most one Space archive is held in memory at a time, and the walk is
one-shot -- iterate it once, and call each entry's `bytes()` once before moving
to the next. A second call to `bytes()`, or one made after the walk has moved
past that entry, rejects. Bytes that are not a tar, or a truncated archive, are
refused with a `BundleInvalidError`. A caller that opens an archive and never
iterates `entries` calls `space.close()` to release the underlying source.

## Exports

The package's root export is documented in [ARCHITECTURE.md](ARCHITECTURE.md);
in short: the archive codec (`packSpaceArchive`, `readSpaceArchive`, the
manifest and file-name helpers), the `BundleInvalidError` the reader raises on a
malformed archive, and the byte-source (`ByteSource`, `byteChunks`,
`collectBytes`) and tar-walk (`tarEntries`, `TarEntry`) helpers a caller needs
to build or consume a `ByteSource`.

## Contribute

PRs accepted. See [CONTRIBUTING.md](CONTRIBUTING.md) for editor setup (Prettier,
ESLint, and EditorConfig) and how it maps to CI.

If editing the Readme, please conform to the
[standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

[MIT License](LICENSE.md) © 2026 Interop Alliance.
