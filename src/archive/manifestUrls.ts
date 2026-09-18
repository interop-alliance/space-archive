/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The documenting URLs a Space export manifest names: the FEP-6fcd manifest
 * file, and the WAS spec sections each archive entry kind is described by.
 * These strings are permanent wire text -- an archive written under them is
 * read back by any consumer that knows them -- so they are copied verbatim
 * from the reference server that minted the dialect and are never rewritten
 * when a spec moves house.
 */

/**
 * FEP-6fcd's manifest-file section, the `url` of the archive's own
 * `manifest.yml` entry.
 */
export const UBC_MANIFEST_URL =
  'https://codeberg.org/fediverse/fep/src/branch/main/fep/6fcd/fep-6fcd.md#manifest-file'

/**
 * The WAS spec's Spaces section: the `url` of the archive's `space/` directory
 * and of the `space/<spaceId>/` directory inside it.
 */
export const SPACE_URL =
  'https://digitalcredentials.github.io/wallet-attached-storage-spec/#spaces'

/**
 * The WAS spec's Collection data model section: the `url` of a Collection
 * Metadata dot-file entry.
 */
export const COLLECTION_URL =
  'https://digitalcredentials.github.io/wallet-attached-storage-spec/#collection-data-model'

/**
 * The WAS spec's Resource data model section: the `url` of a Resource
 * representation entry.
 */
export const RESOURCE_URL =
  'https://digitalcredentials.github.io/wallet-attached-storage-spec/#resource-data-model'

/**
 * The WAS spec's Policy section: the `url` of an access-control policy
 * dot-file entry.
 */
export const POLICY_URL =
  'https://digitalcredentials.github.io/wallet-attached-storage-spec/#policy'

/**
 * The WAS spec's Resource metadata data model section: the `url` of a Resource
 * metadata sidecar entry.
 */
export const META_URL =
  'https://digitalcredentials.github.io/wallet-attached-storage-spec/#resource-metadata-data-model'
