/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Reads a policy file's body back into the policy document it stores. A
 * Space, Collection or Resource policy file holds the document whole, a JSON
 * object discriminated by its `type` member.
 */
import type { PolicyDocument } from '@interop/storage-core'
import { BundleInvalidError } from '../errors.js'

/**
 * Parses a policy file's bytes into its policy document. The reader knows no
 * policy type: an unrecognized `type` is returned as it came, and granting
 * nothing on it is the caller's concern.
 *
 * @param options {object}
 * @param options.bytes {Uint8Array}   the file's bytes
 * @returns {PolicyDocument}
 * @throws {BundleInvalidError}   when the body is not a JSON object with a
 *   string `type`
 */
export function policyFromFile({
  bytes
}: {
  bytes: Uint8Array
}): PolicyDocument {
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch (err) {
    throw new BundleInvalidError('The policy file is not parseable JSON.', {
      cause: err
    })
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).type !== 'string'
  ) {
    throw new BundleInvalidError(
      'The policy file is not a JSON object with a string "type".'
    )
  }
  return body as PolicyDocument
}
