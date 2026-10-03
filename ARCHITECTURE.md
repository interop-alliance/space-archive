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
src/archive/metadataFile.ts      A Metadata file's body read back, `_generation` removed
src/archive/policyFile.ts        A policy file's body read back as its policy document
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
is fixed, and the reader depends on the first four positions: the manifest, then
the optional root entries `service.json`, `provenance.jsonl`, and `did.jsonl` in
that order. A root entry placed later is treated as content.

```
manifest.yml                       the UBC v0.1 manifest, always first
service.json                       the exporting server's Service Description,
                                   verbatim; absent when the exporter gave none
provenance.jsonl                   the exporting server's provenance statements,
                                   verbatim; absent when the exporter gave none
did.jsonl                          the exporting server's DID log snapshot,
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

A chunk directory's entries are packed together. `packDirectory`
(`src/archive/exportTar.ts`) writes the directory entry and then every file
under it before any other entry, so no other entry falls between them. Where the
directory sits relative to its Resource's representation file is not fixed. The
profile spec now requires this contiguity of every writer, and a reader may
refuse an archive that splits a directory. The migration walk in
`@interop/wallet-backup` depends on it to buffer one Resource's chunks at a
time.

`service.json` is informational. It travels so an importer can read which
specification versions and feature set the contents were written under -- an
account's Spaces may live on different servers -- and decide what to do with
them, or refuse, before writing anything. This codec neither checks it nor acts
on it: the writer takes the object and serializes it, the reader parses it and
hands it over. It is not named in the manifest's `contents`, which describes the
Space being exported rather than the server that exported it.

`provenance.jsonl` and `did.jsonl` carry the exporting server's signed claims
about the Space's objects. The first holds one statement per exported object,
one JSON object per line. The second is a snapshot of the history log of the DID
that signed them, so the statements verify offline. The statement format and its
verification belong to the exporting server and to whoever imports the archive.
This codec takes both bodies as bytes or strings and writes them verbatim, and
the reader hands them back as bytes, unparsed and unverified. Unlike
`service.json`, both are listed in the manifest's `contents`, right after the
manifest's own entry, because they describe the Space's contents. Neither is
listed with a documenting `url`, since no specification section describes either
yet. The reader reads them eagerly, as it does `service.json`, so an importer
holds the statements before it reaches the first object they describe. A
statement is a few hundred bytes per object, the same order of size as the
manifest, which already lists every file.

## Invariants

1. **One implementation of the archive layout.** This package is the one reader
   and writer of the per-Space archive dialect: the file names, the
   `manifest.yml` shape, and the pack order. `@interop/wallet-backup`'s bundle
   codec and migration walk, and the WAS reference server, import it rather than
   re-deriving any of it.
2. **The packer's output is byte-stable.** Every tar header carries the epoch
   `mtime` (`EXPORT_ENTRY_MTIME`) and entries are written in a fixed order, so
   two packs of an unchanged entry tree are byte-identical. Upheld by
   `exportTar.ts`, and pinned by the checked-in fixture
   `fixtures/space-archive.tar` (rewritten by
   `test/fixtures/space-archive/generate.ts`), which the WAS reference server's
   own export is compared against by a counterpart test. The fixture is
   published with the package, as the subpath export
   `@interop/space-archive/fixtures/space-archive.tar`, so that test pins
   against the version it depends on. The fixture carries no `service.json`: a
   Service Description is the exporting deployment's, not the layout's, so
   pinning one would pin a server version into the tree the counterpart test
   stages. The entry's position is pinned by a node test instead. A second
   fixture, `fixtures/space-archive-provenance.tar` (subpath export
   `@interop/space-archive/fixtures/space-archive-provenance.tar`), packs the
   same tree with `provenance.jsonl` and `did.jsonl`. Their bodies are checked
   in beside the generator as the WAS reference server wrote them, and the
   server's counterpart test reproduces them byte for byte from the same seed
   and log. The fixture tree has the record layout that server exports, write
   stamps included, so a change to that layout regenerates both fixtures and
   both bodies.
3. **Nothing large is held whole.** The reader parses its manifest from the
   first tar entry, reads the small root entries after it (`service.json`,
   `provenance.jsonl`, `did.jsonl`), and then walks the rest lazily, so at most
   one Space archive is in memory at a time. The packer mirrors this on the
   write side: `packSpaceArchive` returns its pack before filling it, and each
   entry waits for the consumer to read it out before the next one is written,
   so a large export never queues more than one entry ahead of its reader. The
   walk is one-shot: a caller iterates it once, and an entry's `bytes()` rejects
   if called twice or after the walk has moved past it. A caller that opens an
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
5. **Manifest URLs are permanent wire text.** The six exported URL constants
   (`UBC_MANIFEST_URL`, `SPACE_URL`, `COLLECTION_URL`, `RESOURCE_URL`,
   `POLICY_URL`, `META_URL`) are copied verbatim from the spec sections they
   document and are never rewritten when a spec moves house. They were corrected
   once, on 2026-09-20, because the five WAS ones named a host the spec is not
   rendered at and two anchors it does not carry.
6. **Error names are the contract.** `BundleInvalidError` sets its own `name`,
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
- **Provenance entry** -- the archive's `provenance.jsonl`: the exporting
  server's signed statements about the Space's objects, one per line, carried
  verbatim beside `manifest.yml`. Written from `packSpaceArchive`'s optional
  `provenance` option, read back as `SpaceArchive.provenance`. This codec
  neither parses nor verifies it. Avoid: signature file, attestations file.
- **DID log snapshot entry** -- the archive's `did.jsonl`: the history log of
  the DID that signed the provenance entry, as the exporting server served it.
  Written from `packSpaceArchive`'s optional `didLog` option, read back as
  `SpaceArchive.didLog`. Avoid: DID document, server log.
- **Write stamp** -- the `updatedAt`, `updatedAtCounter` and `originId` members
  a WAS server stores on each versioned record (a Metadata file, a governing
  history log record, a Resource sidecar and its `meta` member). A Metadata file
  keeps them in its body. This codec carries them as part of the object and does
  not read them. Avoid: version, revision counter.
- **Reserved Space id** -- the Space id `policy`. Refused by
  `spaceMetadataFileName` and `packSpaceArchive` because its Space Metadata file
  name would be `.space.policy.json`, the same name as the Space's own policy
  file. Lives in `src/archive/resourceFileName.ts` (`RESERVED_SPACE_ID`,
  `assertSpaceIdNotReserved`). Avoid: forbidden Space id, blocked id.

## Current State labels

- Current: the codec has no `Transitional` or `Desired Direction` areas as of
  the move from `@interop/wallet-backup`; it is exactly the archive dialect
  moved verbatim, with nothing else added.
