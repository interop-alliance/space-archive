/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Reads a Metadata file's body back into the Metadata object it stores. A
 * Space Metadata file (`.space.<spaceId>.json`) and a Collection Metadata file
 * (`.collection.<collectionId>.json`) each hold the stored object whole, with
 * its generation embedded under the reserved `_generation` member. That
 * embedding is the storage convention both reference-server backends write, so
 * the generation survives an export and import round trip. The write stamp
 * (`updatedAt`, `updatedAtCounter`, `originId`) is part of the object and is
 * kept. A reader that wants the object itself strips `_generation` here.
 *
 * The readers know no Metadata schema. The result is a plain JSON object, and
 * checking its members is the caller's concern. The one exception is
 * `collectionGeneratorFromMetadata`, which checks the `generator` member's
 * shape for a caller that hands it on.
 */
import type { CollectionGenerator } from '@interop/storage-core'
import { BundleInvalidError } from '../errors.js'

/**
 * Parses a Metadata file's bytes and removes the embedded `_generation`.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @param options.label {string}   names the file in a refusal
 * @returns {Record<string, unknown>}
 */
function metadataFromFile({
  bytes,
  label
}: {
  bytes: Uint8Array
  label: string
}): Record<string, unknown> {
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch (err) {
    throw new BundleInvalidError(`The ${label} is not parseable JSON.`, {
      cause: err
    })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BundleInvalidError(`The ${label} is not a JSON object.`)
  }
  const { _generation: _embedded, ...metadata } = body as Record<
    string,
    unknown
  >
  return metadata
}

/**
 * Reads a Collection Metadata file (`.collection.<collectionId>.json`) into
 * the Collection Metadata object it stores, without the embedded
 * `_generation`. A governed Collection's `encryption` descriptor is not in
 * this file; it derives from the Collection's governing history log
 * (`.collectionlog.<collectionId>.json`).
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {Record<string, unknown>}
 * @throws {BundleInvalidError}   when the body is not a JSON object
 */
export function collectionMetadataFromFile({
  bytes
}: {
  bytes: Uint8Array
}): Record<string, unknown> {
  return metadataFromFile({ bytes, label: 'Collection Metadata file' })
}

/**
 * Reads a Space Metadata file (`.space.<spaceId>.json`) into the Space
 * Metadata object it stores, without the embedded `_generation`.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {Record<string, unknown>}
 * @throws {BundleInvalidError}   when the body is not a JSON object
 */
export function spaceMetadataFromFile({
  bytes
}: {
  bytes: Uint8Array
}): Record<string, unknown> {
  return metadataFromFile({ bytes, label: 'Space Metadata file' })
}

/**
 * Reads the `generator` out of a Collection Metadata object, as
 * `collectionMetadataFromFile` returns it. A `generator` that is absent, is
 * not an object, has no string `id`, or has an `origin`, `url` or `name` that
 * is not a string yields `undefined`.
 *
 * @param metadata {Record<string, unknown>}
 * @returns {CollectionGenerator | undefined}
 */
export function collectionGeneratorFromMetadata(
  metadata: Record<string, unknown>
): CollectionGenerator | undefined {
  const candidate = metadata.generator
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }
  const members = candidate as Record<string, unknown>
  if (typeof members.id !== 'string') {
    return undefined
  }
  const generator: CollectionGenerator = {
    id: members.id as CollectionGenerator['id']
  }
  for (const member of ['origin', 'url', 'name'] as const) {
    const value = members[member]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string') {
      return undefined
    }
    generator[member] = value
  }
  return generator
}
