/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
import fs from 'node:fs'
import * as tar from 'tar-stream'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  byteChunks,
  classifyCollectionFile,
  collectBytes,
  collectionLogFileName,
  collectionMetadataFileName,
  fileNameFor,
  metaSidecarFileName,
  packSpaceArchive,
  parseArchiveManifest,
  parseArchivePath,
  parseResourceFileName,
  readSpaceArchive,
  RESOURCE_URL,
  spaceMetadataFileName,
  tarEntries
} from '../../src/index.js'
import type { ByteSource, TarEntry } from '../../src/index.js'
import {
  fixtureArchivePath,
  packFixtureArchive,
  FIXTURE_COLLECTION_ID,
  FIXTURE_REPRESENTATION_FILE_NAME,
  FIXTURE_RESOURCE_ID,
  FIXTURE_SPACE_ID
} from '../fixtures/space-archive/generate.js'

/**
 * Packs a raw tar directly (bypassing the Space archive writer), for the
 * malformed inputs the writer itself would never produce.
 * @param entries {Array<{ name: string, body: string | Uint8Array }>}
 * @returns {Promise<Uint8Array>}
 */
async function packRawTar(
  entries: { name: string; body: string | Uint8Array }[]
): Promise<Uint8Array> {
  const pack = tar.pack()
  for (const entry of entries) {
    pack.entry({ name: entry.name }, entry.body)
  }
  pack.finalize()
  return collectBytes(pack as unknown as AsyncIterable<Uint8Array>)
}

/**
 * Wraps bytes as an async generator of small chunks, with a `finally` that
 * calls `onClose` once the source is released -- drained fully, or torn down
 * early through the iterator's `return()`.
 * @param options {object}
 * @param options.bytes {Uint8Array}
 * @param options.chunkSize {number}
 * @param options.onClose {Function}
 * @returns {AsyncGenerator<Uint8Array>}
 */
async function* flaggedChunks({
  bytes,
  chunkSize,
  onClose
}: {
  bytes: Uint8Array
  chunkSize: number
  onClose: () => void
}): AsyncGenerator<Uint8Array> {
  try {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      yield bytes.subarray(offset, offset + chunkSize)
    }
  } finally {
    onClose()
  }
}

/**
 * Walks a tar to its end, reading every entry's bytes.
 * @param source {ByteSource}
 * @returns {Promise<void>}
 */
async function walkAll(source: ByteSource): Promise<void> {
  for await (const entry of tarEntries(source)) {
    await entry.bytes()
  }
}

describe('tarEntries', () => {
  it('walks a large archive fed in small chunks without leaking listeners', async () => {
    const entrySize = 20 * 1024 * 1024
    const bytes = await packRawTar([
      { name: 'big.bin', body: Buffer.alloc(entrySize) }
    ])

    const chunkSize = 64 * 1024
    const warnings: Error[] = []
    function onWarning(warning: Error): void {
      warnings.push(warning)
    }
    process.on('warning', onWarning)
    try {
      await walkAll(flaggedChunks({ bytes, chunkSize, onClose: () => {} }))
    } finally {
      process.off('warning', onWarning)
    }
    expect(
      warnings.filter(warning => warning.name === 'MaxListenersExceededWarning')
    ).toEqual([])
  })

  it('refuses bytes that are not a tar as an invalid bundle', async () => {
    const garbage = new Uint8Array(2048).fill(0x41)
    await expect(readSpaceArchive(garbage)).rejects.toMatchObject({
      name: 'BundleInvalidError'
    })
  })

  it('refuses a truncated archive as an invalid bundle', async () => {
    const bytes = await packFixtureArchive()
    const truncated = bytes.subarray(0, 700)
    await expect(walkAll(truncated)).rejects.toMatchObject({
      name: 'BundleInvalidError'
    })
  })

  it("passes the source's own failure through unwrapped", async () => {
    const bytes = await packFixtureArchive()
    const failure = new Error('network down')
    async function* failingSource(): AsyncGenerator<Uint8Array> {
      yield bytes.subarray(0, 512)
      throw failure
    }
    await expect(walkAll(failingSource())).rejects.toBe(failure)
  })

  it('rejects a second bytes() call and one made after the walk advanced', async () => {
    const bytes = await packRawTar([
      { name: 'first.bin', body: new Uint8Array(3000) },
      { name: 'second.bin', body: new Uint8Array(10) }
    ])
    const walk = tarEntries(bytes)
    const first = await walk.next()
    if (first.done) {
      throw new Error('expected an entry')
    }
    expect((await first.value.bytes()).byteLength).toBe(3000)
    await expect(first.value.bytes()).rejects.toThrow(/already read/)

    const second = await walk.next()
    if (second.done) {
      throw new Error('expected an entry')
    }
    await walk.next()
    await expect(second.value.bytes()).rejects.toThrow(/moved past/)
  })
})

describe('byteChunks', () => {
  it('cancels a web ReadableStream when the consumer stops early', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16))
      },
      cancel() {
        cancelled = true
      }
    })
    for await (const chunk of byteChunks(stream)) {
      expect(chunk.byteLength).toBe(16)
      break
    }
    expect(cancelled).toBe(true)
  })
})

describe('resource file names', () => {
  it('round-trips a dotted resource id and content type', () => {
    const fileName = fileNameFor({
      resourceId: 'note.1',
      contentType: 'application/vnd.api+json'
    })
    // No extension is registered for this media type, so the codec's `blob`
    // fallback names the last segment.
    expect(fileName).toBe('r.note%2E1.application%2Fvnd%2Eapi%2Bjson.blob')
    expect(parseResourceFileName(fileName)).toEqual({
      resourceId: 'note.1',
      contentType: 'application/vnd.api+json'
    })
  })

  it('round-trips an id that looks like a file name', () => {
    const fileName = fileNameFor({
      resourceId: 'index.html',
      contentType: 'text/html'
    })
    expect(parseResourceFileName(fileName)).toEqual({
      resourceId: 'index.html',
      contentType: 'text/html'
    })
  })

  it("builds the fixture's literal file names", () => {
    expect(spaceMetadataFileName(FIXTURE_SPACE_ID)).toBe(
      `.space.${FIXTURE_SPACE_ID}.json`
    )
    expect(collectionMetadataFileName(FIXTURE_COLLECTION_ID)).toBe(
      `.collection.${FIXTURE_COLLECTION_ID}.json`
    )
    expect(collectionLogFileName(FIXTURE_COLLECTION_ID)).toBe(
      `.collectionlog.${FIXTURE_COLLECTION_ID}.json`
    )
    expect(metaSidecarFileName(FIXTURE_RESOURCE_ID)).toBe(
      `.meta.${FIXTURE_RESOURCE_ID}.json`
    )
    expect(
      fileNameFor({
        resourceId: FIXTURE_RESOURCE_ID,
        contentType: 'application/json'
      })
    ).toBe(FIXTURE_REPRESENTATION_FILE_NAME)
  })

  it('classifies every kind of Collection-dir file name', () => {
    expect(classifyCollectionFile('.collection.notes.json')).toEqual({
      kind: 'collectionMetadata',
      collectionId: 'notes'
    })
    expect(classifyCollectionFile('.collection.policy.json')).toEqual({
      kind: 'policy',
      scope: 'collection'
    })
    expect(classifyCollectionFile('.collectionlog.notes.json')).toEqual({
      kind: 'collectionLog',
      collectionId: 'notes'
    })
    expect(classifyCollectionFile('.meta.note.1.json')).toEqual({
      kind: 'metaSidecar',
      resourceId: 'note.1'
    })
    expect(classifyCollectionFile('.r.note.1.policy.json')).toEqual({
      kind: 'resourcePolicy',
      resourceId: 'note.1'
    })
    expect(classifyCollectionFile('.chunks.note%2E1')).toEqual({
      kind: 'chunkDirectory',
      resourceId: 'note.1'
    })
    expect(
      classifyCollectionFile(
        fileNameFor({ resourceId: 'note.1', contentType: 'application/json' })
      )
    ).toEqual({
      kind: 'representation',
      resourceId: 'note.1',
      contentType: 'application/json'
    })
    expect(classifyCollectionFile('README')).toEqual({ kind: 'other' })
  })

  it('classifies malformed percent-encoded names as other rather than throwing', () => {
    expect(classifyCollectionFile('r.%E0.x.json')).toEqual({ kind: 'other' })
    expect(classifyCollectionFile('.chunks.%zz')).toEqual({ kind: 'other' })
  })
})

describe('packSpaceArchive and readSpaceArchive', () => {
  it('round-trips the packed tree', async () => {
    const archive = await readSpaceArchive(await packFixtureArchive())
    expect(archive.spaceId).toBe(FIXTURE_SPACE_ID)
    expect(archive.manifest['ubc-version']).toBe('0.1')

    const entries: TarEntry[] = []
    const bytes = new Map<string, Uint8Array>()
    for await (const entry of archive.entries) {
      entries.push(entry)
      if (entry.type === 'file') {
        bytes.set(entry.name, await entry.bytes())
      }
    }

    expect(entries.map(entry => entry.name)).toEqual([
      'space/',
      `space/${FIXTURE_SPACE_ID}/`,
      `space/${FIXTURE_SPACE_ID}/.space.${FIXTURE_SPACE_ID}.json`,
      `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/`,
      `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/.collection.${FIXTURE_COLLECTION_ID}.json`,
      `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/.collectionlog.${FIXTURE_COLLECTION_ID}.json`,
      `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/.meta.${FIXTURE_RESOURCE_ID}.json`,
      `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/r.note%2E1.application%2Fjson.json`,
      'revocations/',
      'revocations/urn%3Auuid%3Afixture-revocation.json'
    ])

    const representationPath = `space/${FIXTURE_SPACE_ID}/${FIXTURE_COLLECTION_ID}/r.note%2E1.application%2Fjson.json`
    const parsed = parseArchivePath(representationPath)
    expect(parsed).toEqual({
      area: 'collection',
      spaceId: FIXTURE_SPACE_ID,
      collectionId: FIXTURE_COLLECTION_ID,
      fileName: 'r.note%2E1.application%2Fjson.json'
    })
    expect(
      JSON.parse(new TextDecoder().decode(bytes.get(representationPath)))
    ).toEqual({ note: 'hello' })
  })

  it('packs a chunk directory in the order the manifest lists it', async () => {
    const bytes = new TextEncoder().encode('chunk')
    const archive = await readSpaceArchive(
      await collectBytes(
        await packSpaceArchive({
          spaceId: 's1',
          entries: [
            {
              name: 'c1',
              files: [
                {
                  name: '.chunks.note%2E1',
                  files: [
                    { name: '.meta.0.json', bytes },
                    { name: 'r.0.text%2Fplain.txt', bytes }
                  ]
                },
                { name: 'r.note%2E1.text%2Fplain.txt', bytes }
              ]
            }
          ]
        })
      )
    )

    const names: string[] = []
    for await (const entry of archive.entries) {
      names.push(entry.name)
    }
    expect(names).toEqual([
      'space/',
      'space/s1/',
      'space/s1/c1/',
      'space/s1/c1/.chunks.note%2E1/',
      'space/s1/c1/.chunks.note%2E1/.meta.0.json',
      'space/s1/c1/.chunks.note%2E1/r.0.text%2Fplain.txt',
      'space/s1/c1/r.note%2E1.text%2Fplain.txt'
    ])

    // A chunk directory's children are listed by bare path; the Resource's
    // own representation carries its documenting url.
    const space = archive.manifest.contents.space as {
      contents: Record<string, { contents: { c1: { contents: unknown[] } }[] }>
    }
    const [collection] = space.contents.s1!.contents
    expect(collection!.c1.contents).toEqual([
      '.chunks.note%2E1/.meta.0.json',
      '.chunks.note%2E1/r.0.text%2Fplain.txt',
      {
        'r.note%2E1.text%2Fplain.txt': { url: RESOURCE_URL }
      }
    ])
  })

  it('parses a chunk directory path', () => {
    expect(
      parseArchivePath('space/s/c/.chunks.note%2E1/r.0.text%2Fplain.txt')
    ).toEqual({
      area: 'chunk',
      spaceId: 's',
      collectionId: 'c',
      resourceId: 'note.1',
      fileName: 'r.0.text%2Fplain.txt'
    })
  })

  it('tells a Collection directory apart from a Space file by the trailing slash', () => {
    expect(parseArchivePath('space/s1/c1/')).toEqual({
      area: 'collection',
      spaceId: 's1',
      collectionId: 'c1',
      fileName: ''
    })
    expect(parseArchivePath('space/s1/.space.s1.json')).toEqual({
      area: 'space',
      spaceId: 's1',
      fileName: '.space.s1.json'
    })
  })

  it('parses a path under a malformed percent-encoded chunk directory as other', () => {
    expect(parseArchivePath('space/s1/c1/.chunks.%zz/r.0.x.json')).toEqual({
      area: 'other'
    })
  })

  it('refuses and releases the source when the manifest names no Space directory', async () => {
    const bytes = await packRawTar([
      { name: 'manifest.yml', body: YAML.stringify({ 'ubc-version': '0.1' }) },
      // Padding so the source is not already exhausted by the time the
      // manifest read refuses: large enough that the pump is still feeding it
      // when the refusal tears the walk down.
      { name: 'padding.bin', body: new Uint8Array(400_000) }
    ])
    let closed = false
    const source = flaggedChunks({
      bytes,
      chunkSize: 512,
      onClose: () => {
        closed = true
      }
    })
    await expect(readSpaceArchive(source)).rejects.toMatchObject({
      name: 'BundleInvalidError'
    })
    expect(closed).toBe(true)
  })

  it('releases the source on close() and on return() before the walk starts', async () => {
    const bytes = await packFixtureArchive()
    for (const release of ['close', 'return'] as const) {
      let closed = false
      const source = flaggedChunks({
        bytes,
        chunkSize: 512,
        onClose: () => {
          closed = true
        }
      })
      const archive = await readSpaceArchive(source)
      if (release === 'close') {
        await archive.close()
      } else {
        await archive.entries[Symbol.asyncIterator]().return?.()
      }
      expect(closed).toBe(true)
    }
  })

  it('refuses a manifest whose Space listing is malformed', async () => {
    for (const contents of [
      { space: { contents: ['a', 'b'] } },
      { space: { contents: 'a' } },
      { space: { contents: { a: {}, b: {} } } }
    ]) {
      const bytes = await packRawTar([
        {
          name: 'manifest.yml',
          body: YAML.stringify({ 'ubc-version': '0.1', contents })
        }
      ])
      await expect(readSpaceArchive(bytes)).rejects.toMatchObject({
        name: 'BundleInvalidError'
      })
    }
  })

  it('reads an unquoted ubc-version as its string', () => {
    const manifest = parseArchiveManifest({
      text: 'ubc-version: 0.1\ncontents: {}\n',
      label: 'Space archive'
    })
    expect(manifest['ubc-version']).toBe('0.1')
  })

  it('parses a path deeper than a chunk file, or with an empty segment, as other', () => {
    expect(parseArchivePath('space/s/c/.chunks.x/a/b')).toEqual({
      area: 'other'
    })
    expect(parseArchivePath('space/s//x')).toEqual({ area: 'other' })
  })

  it('refuses the reserved Space id', async () => {
    expect(() => spaceMetadataFileName('policy')).toThrow(/reserved/)
    await expect(
      packSpaceArchive({ spaceId: 'policy', entries: [] })
    ).rejects.toThrow(/reserved/)
  })

  it('fills the pack at the pace it is read', async () => {
    const reads: string[] = []
    const names = ['a', 'b', 'c', 'd']
    const pack = await packSpaceArchive({
      spaceId: 's1',
      entries: names.map(name => ({
        name,
        read: () => {
          reads.push(name)
          return Promise.resolve(new Uint8Array(200_000))
        }
      }))
    })
    // Nothing has read the pack yet, so at most the first body is in flight.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reads.length).toBeLessThan(names.length)
    await collectBytes(pack)
    expect(reads).toEqual(names)
  })

  it("fails the pack's reader when a read() thunk rejects", async () => {
    const pack = await packSpaceArchive({
      spaceId: 's1',
      entries: [{ name: 'a', read: () => Promise.reject(new Error('gone')) }]
    })
    await expect(collectBytes(pack)).rejects.toThrow('gone')
  })

  it('is byte-reproducible across two packs', async () => {
    const first = await packFixtureArchive()
    const second = await packFixtureArchive()
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
  })

  it('reproduces the checked-in fixture archive', async () => {
    const checkedIn = fs.readFileSync(fixtureArchivePath())
    const packed = await packFixtureArchive()
    expect(Buffer.from(packed).equals(checkedIn)).toBe(true)
  })
})
