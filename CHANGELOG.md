# @interop/space-archive Changelog

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
