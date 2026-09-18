/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * The package's error classes. Each sets its own `name`, and that name is the
 * contract: a consumer in another package tells these apart by `err.name`,
 * never by `instanceof`, since two copies of this package in one dependency
 * tree carry two distinct classes for the same failure.
 */

/**
 * The bytes cannot be read as a Space archive, or as the backup bundle that
 * carries one: they are not a tar, the archive carries no `manifest.yml`, the
 * manifest is not parseable YAML, or it carries no `ubc-version`. The bundle
 * codec in `@interop/wallet-backup` raises the same name, so a consumer reports
 * a bad inner archive and a bad bundle the same way.
 */
export class BundleInvalidError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BundleInvalidError'
  }
}
