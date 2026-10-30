/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The documenting URLs a Space export manifest names: the PWS spec sections
 * that define the archive manifest itself and each archive entry kind whose
 * shape the spec fixes (its Space Archive Format section is their source).
 * Each is the spec's identifier (`https://w3id.org/pws`) plus the defining
 * section's anchor, not the rendered document's location, so it does not
 * change when the spec moves house. These strings are wire text: an archive
 * written under them keeps them, and is read back by any consumer that knows
 * them.
 */

/**
 * The PWS spec's Archive manifest section: the `url` of the archive's own
 * `manifest.yml` entry.
 */
export const MANIFEST_URL = 'https://w3id.org/pws#archive-manifest'

/**
 * The PWS spec's Spaces section: the `url` of the archive's `space/` directory
 * and of the `space/<spaceId>/` directory inside it.
 */
export const SPACE_URL = 'https://w3id.org/pws#spaces'

/**
 * The PWS spec's Collection Metadata data model section: the `url` of a
 * Collection Metadata dot-file entry.
 */
export const COLLECTION_URL =
  'https://w3id.org/pws#collection-metadata-data-model'

/**
 * The PWS spec's Access Control Policies section: the `url` of an
 * access-control policy dot-file entry.
 */
export const POLICY_URL = 'https://w3id.org/pws#access-control-policies'

/**
 * The PWS spec's Resource metadata data model section: the `url` of a Resource
 * metadata sidecar entry.
 */
export const META_URL = 'https://w3id.org/pws#resource-metadata-data-model'
