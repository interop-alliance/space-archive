/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
import { describe, expect, it } from 'vitest'
import {
  collectionGeneratorFromMetadata,
  collectionMetadataFromFile,
  policyFromFile,
  spaceMetadataFromFile
} from '../../src/index.js'

/**
 * Encodes a string as the bytes a Metadata file entry carries.
 * @param text {string}
 * @returns {Uint8Array}
 */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('collectionMetadataFromFile', () => {
  it('returns the stored object without the embedded validator', () => {
    const stored = {
      id: 'notes',
      type: ['Collection'],
      name: 'Notes',
      generator: { id: 'did:key:z6MkApp', origin: 'https://app.example' },
      custom: { color: 'blue' },
      _generation: 'gen-1',
      _version: 3
    }
    expect(
      collectionMetadataFromFile({ bytes: bytesOf(JSON.stringify(stored)) })
    ).toEqual({
      id: 'notes',
      type: ['Collection'],
      name: 'Notes',
      generator: { id: 'did:key:z6MkApp', origin: 'https://app.example' },
      custom: { color: 'blue' }
    })
  })

  it('reads a body that carries no validator members', () => {
    expect(
      collectionMetadataFromFile({ bytes: bytesOf('{"id":"notes"}') })
    ).toEqual({ id: 'notes' })
  })

  it('refuses bytes that are not JSON', () => {
    expect(() =>
      collectionMetadataFromFile({ bytes: bytesOf('{not json') })
    ).toThrow(expect.objectContaining({ name: 'BundleInvalidError' }) as Error)
  })

  it.each(['[]', 'null', '"notes"', '42'])(
    'refuses a body that is not a JSON object: %s',
    text => {
      expect(() =>
        collectionMetadataFromFile({ bytes: bytesOf(text) })
      ).toThrow(
        expect.objectContaining({ name: 'BundleInvalidError' }) as Error
      )
    }
  )
})

describe('spaceMetadataFromFile', () => {
  it('returns the stored object without the embedded validator', () => {
    const stored = {
      id: 'space-1',
      controller: 'did:key:z6MkOwner',
      _generation: 'gen-2',
      _version: 1
    }
    expect(
      spaceMetadataFromFile({ bytes: bytesOf(JSON.stringify(stored)) })
    ).toEqual({ id: 'space-1', controller: 'did:key:z6MkOwner' })
  })

  it('refuses a body that is not a JSON object', () => {
    expect(() => spaceMetadataFromFile({ bytes: bytesOf('[1]') })).toThrow(
      expect.objectContaining({ name: 'BundleInvalidError' }) as Error
    )
  })
})

describe('collectionGeneratorFromMetadata', () => {
  it('returns a well-formed generator with its optional members', () => {
    const generator = {
      id: 'did:key:z6MkApp',
      origin: 'https://app.example',
      url: 'https://app.example/about',
      name: 'Example App'
    }
    expect(collectionGeneratorFromMetadata({ generator })).toEqual(generator)
  })

  it('drops members outside id, origin, url and name', () => {
    expect(
      collectionGeneratorFromMetadata({
        generator: { id: 'did:key:z6MkApp', extra: 1 }
      })
    ).toEqual({ id: 'did:key:z6MkApp' })
  })

  it.each([
    ['absent', {}],
    ['not an object', { generator: 'did:key:z6MkApp' }],
    ['null', { generator: null }],
    ['without an id', { generator: { name: 'Example App' } }],
    ['with a non-string id', { generator: { id: 42 } }],
    [
      'with a non-string optional member',
      { generator: { id: 'did:key:z6MkApp', origin: 42 } }
    ]
  ])('yields undefined for a generator %s', (_label, metadata) => {
    expect(collectionGeneratorFromMetadata(metadata)).toBeUndefined()
  })
})

describe('policyFromFile', () => {
  it('returns the stored policy document', () => {
    expect(
      policyFromFile({ bytes: bytesOf('{"type":"PublicCanRead"}') })
    ).toEqual({ type: 'PublicCanRead' })
  })

  it('returns an unrecognized policy type as it came', () => {
    expect(
      policyFromFile({ bytes: bytesOf('{"type":"FutureType","extra":1}') })
    ).toEqual({ type: 'FutureType', extra: 1 })
  })

  it.each(['{not json', '[]', 'null', '{}', '{"type":42}'])(
    'refuses a body that is not a typed policy document: %s',
    text => {
      expect(() => policyFromFile({ bytes: bytesOf(text) })).toThrow(
        expect.objectContaining({ name: 'BundleInvalidError' }) as Error
      )
    }
  )
})
