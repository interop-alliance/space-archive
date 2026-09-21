# @interop/space-archive Changelog

## 0.2.0 - TBD

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
