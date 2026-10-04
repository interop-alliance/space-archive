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
 * A Collection tombstone is a Collection Metadata file whose body carries
 * `deleted: true` beside the write stamp and `_generation`. It is read with
 * `collectionTombstoneFromFile`, and `collectionMetadataFromFile` refuses it,
 * so each reader returns only the record its name says.
 *
 * The readers know no Metadata schema. The result is a plain JSON object, and
 * checking its members is the caller's concern. The exceptions are the
 * `deleted` member, which tells a tombstone from a live object, and
 * `collectionGeneratorFromMetadata`, which checks the `generator` member's
 * shape for a caller that hands it on.
 */
import { isWriteStamp } from '@interop/storage-core'
import type { CollectionGenerator, WriteStamp } from '@interop/storage-core'
import { BundleInvalidError } from '../errors.js'

/**
 * Parses a Metadata file's bytes and removes the embedded `_generation`. The
 * one rule for what a Metadata file body is, shared by the readers here.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @param options.label {string}   names the file in a refusal
 * @returns {Record<string, unknown>}
 * @throws {BundleInvalidError}   when the body is not a JSON object
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
 * Whether a Collection Metadata file's body is a Collection tombstone: the
 * record a deleted Collection leaves, marked `deleted: true`. Reads the parsed
 * body, with or without its embedded `_generation`. A live Collection
 * Metadata object carries no `deleted` member.
 *
 * @param metadata {Record<string, unknown>}
 * @returns {boolean}
 */
export function isCollectionTombstone(
  metadata: Record<string, unknown>
): metadata is Record<string, unknown> & { deleted: true } {
  return metadata.deleted === true
}

/**
 * Whether a file's bytes hold a Collection tombstone body: a JSON object
 * marked `deleted: true`. Bytes that are not a JSON object hold none. The
 * packer asks this of a Collection Metadata file inside its Collection
 * directory, where a tombstone has no place.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {boolean}
 */
export function holdsCollectionTombstone({
  bytes
}: {
  bytes: Uint8Array
}): boolean {
  try {
    return isCollectionTombstone(
      metadataFromFile({ bytes, label: 'Collection Metadata file' })
    )
  } catch (err) {
    if (err instanceof BundleInvalidError) {
      return false
    }
    throw err
  }
}

/**
 * Reads a Collection Metadata file (`.collection.<collectionId>.json`) into
 * the Collection Metadata object it stores, without the embedded
 * `_generation`. A governed Collection's `encryption` descriptor is not in
 * this file; it derives from the Collection's governing history log
 * (`.collectionlog.<collectionId>.json`). A tombstone body is refused, since
 * a tombstone is not a Collection Metadata object; read it with
 * {@link collectionTombstoneFromFile}.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {Record<string, unknown>}
 * @throws {BundleInvalidError}   when the body is not a JSON object, or is a
 *   Collection tombstone
 */
export function collectionMetadataFromFile({
  bytes
}: {
  bytes: Uint8Array
}): Record<string, unknown> {
  const metadata = metadataFromFile({
    bytes,
    label: 'Collection Metadata file'
  })
  if (isCollectionTombstone(metadata)) {
    throw new BundleInvalidError(
      'The Collection Metadata file is a Collection tombstone.'
    )
  }
  return metadata
}

/**
 * Reads a Collection tombstone's file (`.collection.<collectionId>.json` in
 * the Space directory) into the tombstone it stores, without the embedded
 * `_generation`: `deleted: true` and the write stamp of the deleting write.
 * The body holds those members and no other. A tombstone without a whole
 * write stamp cannot be ordered against a peer's copy of the Collection, and
 * one that keeps members of the live Metadata object is not a tombstone.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {WriteStamp & { deleted: true }}
 * @throws {BundleInvalidError}   when the body is not a JSON object, does not
 *   carry `deleted: true`, lacks a whole write stamp, or carries any other
 *   member
 */
export function collectionTombstoneFromFile({
  bytes
}: {
  bytes: Uint8Array
}): WriteStamp & { deleted: true } {
  const metadata = metadataFromFile({
    bytes,
    label: 'Collection tombstone file'
  })
  if (!isCollectionTombstone(metadata)) {
    throw new BundleInvalidError(
      'The Collection tombstone file does not carry "deleted: true".'
    )
  }
  if (!isWriteStamp(metadata)) {
    throw new BundleInvalidError(
      'The Collection tombstone file does not carry a whole write stamp.'
    )
  }
  const { deleted, updatedAt, updatedAtCounter, originId, ...others } = metadata
  const extra = Object.keys(others)
  if (extra.length > 0) {
    throw new BundleInvalidError(
      `The Collection tombstone file carries members a tombstone does not hold: ${extra.join(', ')}.`
    )
  }
  return { deleted, updatedAt, updatedAtCounter, originId }
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
