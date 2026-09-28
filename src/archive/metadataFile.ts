/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Reads a Metadata file's body back into the Metadata object it stores. A
 * Space Metadata file (`.space.<spaceId>.json`) and a Collection Metadata file
 * (`.collection.<collectionId>.json`) each hold the stored object whole, with
 * its validator embedded under the reserved `_generation` / `_version` members.
 * That embedding is the storage convention both reference-server backends
 * write, so the validator survives an export and import round trip. A reader
 * that wants the object itself strips those two members here.
 *
 * This codec knows no Metadata schema. The result is a plain JSON object, and
 * checking its members is the caller's concern.
 */
import { BundleInvalidError } from '../errors.js'

/**
 * The members a Metadata file embeds its validator under, removed on read.
 */
const EMBEDDED_VALIDATOR_MEMBERS = ['_generation', '_version']

/**
 * Parses a Metadata file's bytes and removes the embedded validator members.
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
  const metadata = { ...(body as Record<string, unknown>) }
  for (const member of EMBEDDED_VALIDATOR_MEMBERS) {
    delete metadata[member]
  }
  return metadata
}

/**
 * Reads a Collection Metadata file (`.collection.<collectionId>.json`) into
 * the Collection Metadata object it stores, without the embedded `_generation`
 * / `_version` validator members. A governed Collection's `encryption`
 * descriptor is not in this file; it derives from the Collection's governing
 * history log (`.collectionlog.<collectionId>.json`).
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
 * Metadata object it stores, without the embedded `_generation` / `_version`
 * validator members.
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
