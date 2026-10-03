# @interop/space-archive Changelog

## 0.6.0 - TBD

### Changed

- **Breaking:** `collectionMetadataFromFile` and `spaceMetadataFromFile` no
  longer strip a `_version` member. `_generation` is the one embedded member
  removed; a reader that relied on `_version` being dropped now sees it.
- Both published fixtures are regenerated for the WAS write stamp. Each Metadata
  file, the governing history log record and the Resource sidecar carry
  `updatedAt`, `updatedAtCounter` and `originId` (the sidecar also a `meta`
  stamp). The Metadata files embed `_generation`, and the log record drops
  `version`. `provenance.jsonl` is rewritten from the server's export of the new
  tree; `did.jsonl` is unchanged.

## 0.5.0 - 2026-09-30

### Added

- Two optional root entries, `provenance.jsonl` and `did.jsonl`: the exporting
  server's signed provenance statements and its DID log snapshot. The packer
  takes them as `provenance` and `didLog` (bytes or strings) and writes them
  verbatim after `service.json`. The manifest lists both after its own entry.
  The reader exposes them as `SpaceArchive.provenance` and
  `SpaceArchive.didLog`, unparsed and unverified.
- `ARCHIVE_PROVENANCE_FILE`, `ARCHIVE_DID_LOG_FILE`, and the `provenance` and
  `didLog` path areas.
- A second published fixture, `fixtures/space-archive-provenance.tar`: the
  existing tree plus both entries.

## 0.4.1 - 2026-09-28

### Changed

- Update to latest storage-core dep.

## 0.4.0 - 2026-09-28

### Added

- `collectionGeneratorFromMetadata(metadata)` reads a Collection Metadata
  object's `generator`. It yields `undefined` when the member is absent or
  malformed.
- `policyFromFile({ bytes })` reads a policy file's body into its policy
  document. A body that is not a JSON object with a string `type` is refused
  with `BundleInvalidError`.
- Depends on `@interop/storage-core` for the `CollectionGenerator` and
  `PolicyDocument` types.

## 0.3.0 - 2026-09-28

### Added

- `collectionMetadataFromFile({ bytes })` and `spaceMetadataFromFile({ bytes })`
  read a Metadata file's body into the stored Metadata object. They remove the
  embedded `_generation` / `_version` validator members. A body that is not a
  JSON object is refused with `BundleInvalidError`.

## 0.2.1 - 2026-09-25

### Added

- The checked-in fixture archive is published with the package, as the subpath
  export `@interop/space-archive/fixtures/space-archive.tar`, so a counterpart
  test in a consuming implementation pins against the fixture of the version it
  depends on. The tar moved from `test/fixtures/space-archive/` to `fixtures/`
  under the package root; `test/fixtures/space-archive/generate.ts` still
  rewrites it.

## 0.2.0 - 2026-09-20

### Added

- The archive carries the exporting server's Service Description verbatim as
  `service.json`, written immediately after `manifest.yml`. `packSpaceArchive`
  takes it as the optional `service` option, and `readSpaceArchive` hands it
  back as `SpaceArchive.service` (`undefined` for an archive that carries none,
  so older archives read unchanged). It is informational: an importer can read
  which specification versions and feature set the contents were written under,
  and this codec neither checks it nor acts on it.
- `ARCHIVE_SERVICE_FILE`, and the `service` area of `parseArchivePath`.
- The checked-in fixture archive's Space Metadata entry carries the server's
  `backends` listing, matching what the reference server now exports.

### Changed

- `readSpaceArchive` reads one entry past the manifest before returning (the
  `service.json` peek), so a tar truncated right after the manifest is refused
  by `readSpaceArchive` itself instead of while iterating `entries`.
- `packSpaceArchive` refuses a `service` value JSON cannot represent before any
  pack is created.

### Fixed

- The manifest's five WAS spec URLs name the spec's rendered host
  (`https://w3c-ccg.github.io/wallet-attached-storage-spec/`) and, for the
  Collection Metadata and policy entries, anchors the spec carries
  (`#collection-metadata-data-model`, `#access-control-policies`). The
  checked-in fixture is regenerated under the corrected values.

## 0.1.0 - 2026-09-18

### Added

- Initial release: the per-Space archive codec, moved verbatim out of
  `@interop/wallet-backup`. The file-name dialect, the manifest builder and its
  six URL constants, the packer (`packSpaceArchive`), the reader
  (`readSpaceArchive`) and its path / file-name classifiers, the byte-source
  adapter, and the lazy tar walk.
- `BundleInvalidError`, moved from `@interop/wallet-backup`'s error classes.
  Bytes that are not a tar, or a truncated archive, are refused with it; a
  failure of the byte source itself passes through unwrapped.
- `packSpaceArchive` returns its pack before filling it and waits for the
  consumer to read each entry out before writing the next, so a large export
  stays bounded in memory.
- `SpaceArchive.close()`, to release an opened archive's byte source when a
  caller does not iterate its entries.
- The Space id `policy` is reserved (`RESERVED_SPACE_ID`):
  `spaceMetadataFileName` and `packSpaceArchive` refuse it, since its Metadata
  file name would collide with the Space policy file.
