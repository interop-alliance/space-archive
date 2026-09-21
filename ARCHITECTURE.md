# Architecture

The current shape of this library, with the rationale inline: why each part is
shaped the way it is, stated where the shape is described. This file is kept
current in the same change set that alters the shape; it overwrites in place and
records no history. History lives elsewhere: CHANGELOG.md for what landed,
`decisions/` for durable decisions with their rejected alternatives and revisit
criteria, and the archived roadmap for the work items. Reference decision
records from here where the resulting shape is described, instead of re-arguing
them.

Several conventions lean on this file, so keep it accurate and current: the
design gate defines a cross-cutting item as one touching an invariant documented
here, a `touches:` entry names this file as a deliverable in its own right, and
the breaking-release audit checks its statements against the code.

## Layer map

```
src/index.ts              Public entry point (the export map's only door)
src/errors.ts             BundleInvalidError, told apart by `name`
src/stream.ts             Byte-source adapter (Uint8Array / stream / async iterable)
src/tarEntries.ts         The lazy tar walk the reader shares with its consumers

src/archive/manifestUrls.ts      The documenting URLs the archive manifest names
src/archive/resourceFileName.ts  The on-disk file-name dialect: built, parsed, classified
src/archive/exportManifest.ts    The archive's `manifest.yml` document
src/archive/exportTar.ts         `packSpaceArchive`: an entry tree to a tar
src/archive/archivePath.ts       The archive path grammar: parsed, and built by the packer
src/archive/readSpaceArchive.ts  The reader
```

The dependency direction is one way: `archive/` reads `stream.ts`,
`tarEntries.ts`, and `errors.ts`, and none of those three know anything about
the archive dialect. Nothing in this package reads `archive/` back; it is the
one leaf concern the package exists to hold.

## Archive layout

One archive is one Space, and its entries are written in this order. The order
is fixed, and the reader depends on the first two positions.

```
manifest.yml                       the UBC v0.1 manifest, always first
service.json                       the exporting server's Service Description,
                                   verbatim; absent when the exporter gave none
revocations/                       the Space-scoped zcap revocation records;
revocations/<record>.json          absent when the Space has none
space/
space/<spaceId>/
space/<spaceId>/<file>             Space-level dot-files
space/<spaceId>/<collectionId>/
space/<spaceId>/<collectionId>/<file>
space/<spaceId>/<collectionId>/.chunks.<encodedResourceId>/<chunkFile>
```

`service.json` is informational. It travels so an importer can read which
specification versions and feature set the contents were written under -- an
account's Spaces may live on different servers -- and decide what to do with
them, or refuse, before writing anything. This codec neither checks it nor acts
on it: the writer takes the object and serializes it, the reader parses it and
hands it over. It is not named in the manifest's `contents`, which describes the
Space being exported rather than the server that exported it.

## Invariants

1. **One implementation of the archive layout.** This package is the one reader
   and writer of the per-Space archive dialect: the file names, the
   `manifest.yml` shape, and the pack order. `@interop/wallet-backup`'s bundle
   codec and migration walk, and the WAS reference server, import it rather than
   re-deriving any of it.
2. **The packer's output is byte-stable.** Every tar header carries the epoch
   `mtime` (`EXPORT_ENTRY_MTIME`) and entries are written in a fixed order, so
   two packs of an unchanged entry tree are byte-identical. Upheld by
   `exportTar.ts`, and pinned by the checked-in fixture under
   `test/fixtures/space-archive/`, which the WAS reference server's own export
   is compared against by a counterpart test. The fixture carries no
   `service.json`: a Service Description is the exporting deployment's, not the
   layout's, so pinning one would pin a server version into the tree the
   counterpart test stages. The entry's position is pinned by a node test
   instead.
3. **Nothing large is held whole.** The reader parses its manifest from the
   first tar entry and then walks the rest lazily, so at most one Space archive
   is in memory at a time. The packer mirrors this on the write side:
   `packSpaceArchive` returns its pack before filling it, and each entry waits
   for the consumer to read it out before the next one is written, so a large
   export never queues more than one entry ahead of its reader. The walk is
   one-shot: a caller iterates it once, and an entry's `bytes()` rejects if
   called twice or after the walk has moved past it. A caller that opens an
   archive and never iterates `entries` calls `SpaceArchive.close()` to release
   the source.
4. **The codec is isomorphic.** No module under `src/` imports `node:*`, and no
   public type names `Buffer`; bytes are `Uint8Array` and streams arrive as a
   `ByteSource`. A Playwright spec packs and reads an archive in Chromium to
   keep this honest. The `events` dependency exists for the browser. Nothing in
   `src/` imports it, but `tar-stream`'s streams (`streamx`, through
   `events-universal`) call `require('events')` without declaring a package that
   provides it outside Node. A bundler resolves that call to the `events`
   package declared here. Without it the browser spec fails inside `tar-stream`.
5. **No `@interop/*` dependency.** This package depends on `tar-stream`, `yaml`,
   `mime-types`, and `events` only, so a consumer that needs just the codec --
   the WAS reference server -- installs none of `@interop/wallet-core`,
   `@interop/was-client`, or the packages those pull in.
6. **Manifest URLs are permanent wire text.** The six exported URL constants
   (`UBC_MANIFEST_URL`, `SPACE_URL`, `COLLECTION_URL`, `RESOURCE_URL`,
   `POLICY_URL`, `META_URL`) are copied verbatim from the spec sections they
   document and are never rewritten when a spec moves house. They were corrected
   once, on 2026-09-20, because the five WAS ones named a host the spec is not
   rendered at and two anchors it does not carry.
7. **Error names are the contract.** `BundleInvalidError` sets its own `name`,
   and a consumer in another package tells it apart by `err.name`, never by
   `instanceof`, since two copies of this package in one dependency tree carry
   two distinct classes for the same failure. It covers bytes that are not a
   tar, a truncated archive, and a manifest that is missing, unparsable, or
   names no single Space directory. A failure of the byte source itself (a
   network error, a rejected `read()`) passes through unwrapped, since that
   failure belongs to the source, not to the archive.

## Ownership heuristics

- The archive dialect (file names, manifest shape, pack order) is this
  package's, shared with the WAS reference server, which builds the entry trees
  out of its own storage backends, and with `@interop/wallet-backup`'s bundle
  codec and migration walk, which read Space archives back out of a bundle. A
  change to the dialect is a change to all three.
- The outer bundle container, key derivation, record sealing, roster and epoch
  handling, and the migration walk belong to `@interop/wallet-backup` and the
  packages it depends on (`@interop/wallet-core`, `@interop/was-client`). This
  package does not read or write bundles, and knows nothing about ciphers or
  rosters. Two pieces are shared with the bundle codec on purpose. The error
  name `BundleInvalidError` covers a bad Space archive and a bad bundle alike,
  so a consumer reports both the same way. `parseArchiveManifest` takes a
  `label` and passes unknown members through, so the bundle manifest goes
  through the same parse.
- HTTP belongs to the host. Nothing here fetches: an archive is bytes in, bytes
  out.

## Glossary

- **Per-Space archive** -- the UBC v0.1 export tarball of a single Space, the
  dialect the WAS reference server writes. Lives in `src/archive/`. Avoid: space
  export, space dump, inner tar.
- **Byte source** -- anything the reader accepts as input bytes: a `Uint8Array`,
  a web `ReadableStream`, or an async iterable of chunks. Lives in
  `src/stream.ts`. Avoid: input stream, reader, source stream.
- **Service Description entry** -- the archive's `service.json`: the exporting
  server's Service Description, carried verbatim beside `manifest.yml`. Written
  from `packSpaceArchive`'s optional `service` option, read back as
  `SpaceArchive.service`. Avoid: service manifest, server description, service
  doc.
- **Reserved Space id** -- the Space id `policy`. Refused by
  `spaceMetadataFileName` and `packSpaceArchive` because its Space Metadata file
  name would be `.space.policy.json`, the same name as the Space's own policy
  file. Lives in `src/archive/resourceFileName.ts` (`RESERVED_SPACE_ID`,
  `assertSpaceIdNotReserved`). Avoid: forbidden Space id, blocked id.

## Current State labels

- Current: the codec has no `Transitional` or `Desired Direction` areas as of
  the move from `@interop/wallet-backup`; it is exactly the archive dialect
  moved verbatim, with nothing else added.
