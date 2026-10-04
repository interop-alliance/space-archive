/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  buildExportManifest,
  collectBytes,
  collectionMetadataFileName,
  collectionTombstoneFromFile,
  COLLECTION_URL,
  packSpaceArchive,
  parseArchivePath,
  readSpaceArchive,
  RESERVED_COLLECTION_ID
} from '../../src/index.js'
import type { ArchiveEntry, TarEntry } from '../../src/index.js'
import { packRawTar } from './helpers.js'

/**
 * The write stamp the test records carry.
 */
const STAMP = {
  updatedAt: '1970-01-01T00:00:00.000Z',
  updatedAtCounter: 0,
  originId: 'zTestOrigin'
}

/**
 * The stored body of a Collection tombstone, as a server exports it.
 */
const TOMBSTONE = { deleted: true, ...STAMP, _generation: 'zOldGeneration' }

/**
 * Encodes a JSON document as the bytes of an archive file.
 * @param document {object}
 * @returns {Uint8Array}
 */
function jsonBytes(document: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document))
}

/**
 * A Space holding one live Collection (`notes`) and one Collection tombstone
 * (`old`), in pack order.
 * @returns {ArchiveEntry[]}
 */
function treeWithTombstone(): ArchiveEntry[] {
  return [
    { name: '.space.s1.json', bytes: jsonBytes({ id: 's1', ...STAMP }) },
    { name: '.collection.old.json', bytes: jsonBytes(TOMBSTONE) },
    {
      name: 'notes',
      files: [
        {
          name: '.collection.notes.json',
          bytes: jsonBytes({ id: 'notes', ...STAMP, _generation: 'zGen' })
        },
        { name: 'r.n1.application%2Fjson.json', bytes: jsonBytes({ a: 1 }) }
      ]
    }
  ]
}

/**
 * Walks an archive's entries to the end, reading each file's bytes.
 * @param entries {AsyncIterable<TarEntry>}
 * @returns {Promise<Map<string, Uint8Array>>}   every entry by name, a
 *   directory with empty bytes
 */
async function readAll(
  entries: AsyncIterable<TarEntry>
): Promise<Map<string, Uint8Array>> {
  const read = new Map<string, Uint8Array>()
  for await (const entry of entries) {
    read.set(
      entry.name,
      entry.type === 'file' ? await entry.bytes() : new Uint8Array()
    )
  }
  return read
}

/**
 * A minimal manifest naming the Space `s1`.
 */
const MANIFEST = YAML.stringify({
  'ubc-version': '0.1',
  contents: { space: { contents: { s1: {} } } }
})

describe('Collection tombstones', () => {
  it('parses a Collection Metadata file in the Space directory as a tombstone', () => {
    expect(parseArchivePath('space/s1/.collection.old.json')).toEqual({
      area: 'collectionTombstone',
      spaceId: 's1',
      collectionId: 'old',
      fileName: '.collection.old.json'
    })
    expect(parseArchivePath('space/s1/.collection.a.b.json')).toMatchObject({
      area: 'collectionTombstone',
      collectionId: 'a.b'
    })
    // The Collection's own policy name shares the prefix and is not one. No
    // tombstone can take that name, since the Collection id `policy` is
    // reserved.
    expect(parseArchivePath('space/s1/.collection.policy.json')).toEqual({
      area: 'space',
      spaceId: 's1',
      fileName: '.collection.policy.json'
    })
    // The live form, inside the Collection directory, is unchanged.
    expect(parseArchivePath('space/s1/old/.collection.old.json')).toEqual({
      area: 'collection',
      spaceId: 's1',
      collectionId: 'old',
      fileName: '.collection.old.json'
    })
  })

  it('lists a tombstone with deleted: true and leaves live entries unchanged', () => {
    const manifest = buildExportManifest({
      spaceId: 's1',
      entries: [
        { name: '.space.s1.json' },
        { name: '.collection.old.json' },
        { name: 'notes', files: ['.collection.notes.json'] }
      ]
    }) as { contents: { space: { contents: { s1: { contents: unknown } } } } }
    expect(manifest.contents.space.contents.s1.contents).toEqual([
      '.space.s1.json',
      { '.collection.old.json': { url: COLLECTION_URL, deleted: true } },
      {
        notes: {
          contents: [{ '.collection.notes.json': { url: COLLECTION_URL } }]
        }
      }
    ])
  })

  it('packs a tombstone with no Collection directory and reads it back', async () => {
    const archive = await readSpaceArchive(
      await collectBytes(
        await packSpaceArchive({ spaceId: 's1', entries: treeWithTombstone() })
      )
    )
    const space = archive.manifest.contents.space as {
      contents: { s1: { contents: unknown[] } }
    }
    expect(space.contents.s1.contents[1]).toEqual({
      '.collection.old.json': { url: COLLECTION_URL, deleted: true }
    })
    expect(JSON.stringify(space.contents.s1.contents[2])).not.toContain(
      'deleted'
    )

    const read = await readAll(archive.entries)
    expect([...read.keys()]).toEqual([
      'space/',
      'space/s1/',
      'space/s1/.space.s1.json',
      'space/s1/.collection.old.json',
      'space/s1/notes/',
      'space/s1/notes/.collection.notes.json',
      'space/s1/notes/r.n1.application%2Fjson.json'
    ])
    const tombstonePath = 'space/s1/.collection.old.json'
    expect(parseArchivePath(tombstonePath).area).toBe('collectionTombstone')
    expect(
      collectionTombstoneFromFile({ bytes: read.get(tombstonePath)! })
    ).toEqual({ deleted: true, ...STAMP })
    // Nothing of the deleted Collection is under a directory of its own.
    expect(
      [...read.keys()].some(name => name.startsWith('space/s1/old/'))
    ).toBe(false)
  })

  it('packs a tombstone whose body is read through a thunk', async () => {
    const bytes = await collectBytes(
      await packSpaceArchive({
        spaceId: 's1',
        entries: [
          {
            name: '.collection.old.json',
            read: () => Promise.resolve(jsonBytes(TOMBSTONE))
          }
        ]
      })
    )
    const read = await readAll((await readSpaceArchive(bytes)).entries)
    expect(
      collectionTombstoneFromFile({
        bytes: read.get('space/s1/.collection.old.json')!
      })
    ).toEqual({ deleted: true, ...STAMP })
  })

  it('refuses a tombstone packed beside a Collection directory of the same id', async () => {
    await expect(
      packSpaceArchive({
        spaceId: 's1',
        entries: [
          { name: '.collection.old.json', bytes: jsonBytes(TOMBSTONE) },
          { name: 'old', files: [] }
        ]
      })
    ).rejects.toThrow(/both as a tombstone and as a Collection directory/)
  })

  it('refuses a body in the tombstone position that is not a tombstone', async () => {
    const { originId: _originId, ...partialStamp } = STAMP
    for (const body of [
      { id: 'old', ...STAMP },
      { deleted: 'yes' },
      { deleted: true },
      { deleted: true, ...partialStamp },
      { ...TOMBSTONE, id: 'old' },
      { ...TOMBSTONE, custom: { name: 'Old notes' } }
    ]) {
      await expect(
        packSpaceArchive({
          spaceId: 's1',
          entries: [{ name: '.collection.old.json', bytes: jsonBytes(body) }]
        })
      ).rejects.toThrow(/not a tombstone body/)
      expect(() =>
        collectionTombstoneFromFile({ bytes: jsonBytes(body) })
      ).toThrow(
        expect.objectContaining({ name: 'BundleInvalidError' }) as Error
      )
    }
    await expect(
      packSpaceArchive({
        spaceId: 's1',
        entries: [
          { name: '.collection.old.json', bytes: new TextEncoder().encode('{') }
        ]
      })
    ).rejects.toThrow(/not a tombstone body/)
    // A thunk's body is checked when it is read, which fails the pack.
    const pack = await packSpaceArchive({
      spaceId: 's1',
      entries: [
        {
          name: '.collection.old.json',
          read: () => Promise.resolve(jsonBytes({ id: 'old' }))
        }
      ]
    })
    await expect(collectBytes(pack)).rejects.toThrow(/not a tombstone body/)
  })

  it('refuses the reserved Collection id', async () => {
    expect(() => collectionMetadataFileName(RESERVED_COLLECTION_ID)).toThrow(
      /reserved/
    )
    await expect(
      packSpaceArchive({
        spaceId: 's1',
        entries: [{ name: 'policy', files: [] }]
      })
    ).rejects.toThrow(/reserved/)
  })

  it('refuses a tombstone body inside its Collection directory', async () => {
    await expect(
      packSpaceArchive({
        spaceId: 's1',
        entries: [
          {
            name: 'old',
            files: [
              { name: '.collection.old.json', bytes: jsonBytes(TOMBSTONE) }
            ]
          }
        ]
      })
    ).rejects.toThrow(/tombstone inside its Collection directory/)
    const pack = await packSpaceArchive({
      spaceId: 's1',
      entries: [
        {
          name: 'old',
          files: [
            {
              name: '.collection.old.json',
              read: () => Promise.resolve(jsonBytes(TOMBSTONE))
            }
          ]
        }
      ]
    })
    await expect(collectBytes(pack)).rejects.toThrow(
      /tombstone inside its Collection directory/
    )
  })

  it('still packs a live Collection Metadata body that is not JSON', async () => {
    const pack = await packSpaceArchive({
      spaceId: 's1',
      entries: [
        {
          name: 'notes',
          files: [
            {
              name: '.collection.notes.json',
              bytes: new TextEncoder().encode('not json')
            }
          ]
        }
      ]
    })
    await expect(collectBytes(pack)).resolves.toBeInstanceOf(Uint8Array)
  })

  it('refuses an archive holding a Collection as both a tombstone and a directory', async () => {
    const tombstone = {
      name: 'space/s1/.collection.old.json',
      body: JSON.stringify(TOMBSTONE)
    }
    const member = { name: 'space/s1/old/r.x.text%2Fplain.txt', body: 'x' }
    for (const order of [
      [tombstone, member],
      [member, tombstone]
    ]) {
      const archive = await readSpaceArchive(
        await packRawTar([{ name: 'manifest.yml', body: MANIFEST }, ...order])
      )
      await expect(readAll(archive.entries)).rejects.toMatchObject({
        name: 'BundleInvalidError'
      })
    }
    // The check also runs on the first content entry, the one the root-entry
    // peek pulled ahead.
    const archive = await readSpaceArchive(
      await packRawTar([
        { name: 'manifest.yml', body: MANIFEST },
        { name: 'space/s1/old/' },
        tombstone
      ])
    )
    await expect(readAll(archive.entries)).rejects.toMatchObject({
      name: 'BundleInvalidError'
    })
  })

  it('scopes the tombstone and directory conflict to one Space directory', async () => {
    // A tombstone in one Space directory and a Collection directory of the
    // same id in another are not one Collection held both ways. A directory
    // entry at the tombstone path is not a tombstone.
    const archive = await readSpaceArchive(
      await packRawTar([
        { name: 'manifest.yml', body: MANIFEST },
        {
          name: 'space/s1/.collection.old.json',
          body: JSON.stringify(TOMBSTONE)
        },
        { name: 'space/s2/old/r.x.text%2Fplain.txt', body: 'x' },
        {
          name: 'space/s1/.collection.gone.json',
          header: { type: 'symlink', linkname: 'x' }
        },
        { name: 'space/s1/gone/r.x.text%2Fplain.txt', body: 'x' }
      ])
    )
    expect((await readAll(archive.entries)).size).toBe(4)
  })

  it('reads a tombstone by its position, whatever the manifest says', async () => {
    // The manifest here carries no `deleted` flag; the entry still reads as a
    // tombstone, since the position and body decide.
    const archive = await readSpaceArchive(
      await packRawTar([
        { name: 'manifest.yml', body: MANIFEST },
        {
          name: 'space/s1/.collection.old.json',
          body: JSON.stringify(TOMBSTONE)
        }
      ])
    )
    const read = await readAll(archive.entries)
    const path = 'space/s1/.collection.old.json'
    expect(parseArchivePath(path).area).toBe('collectionTombstone')
    expect(collectionTombstoneFromFile({ bytes: read.get(path)! })).toEqual({
      deleted: true,
      ...STAMP
    })
  })
})
