/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
import fs from 'node:fs'
import YAML from 'yaml'
import { describe, expect, it, vi } from 'vitest'
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
import type { ArchiveEntry, ByteSource, TarEntry } from '../../src/index.js'
import {
  fixtureArchivePath,
  packFixtureArchive,
  packProvenanceFixtureArchive,
  provenanceFixtureArchivePath,
  provenanceFixtureInputs,
  FIXTURE_COLLECTION_ID,
  FIXTURE_REPRESENTATION_FILE_NAME,
  FIXTURE_RESOURCE_ID,
  FIXTURE_SPACE_ID
} from '../fixtures/space-archive/generate.js'
import { packRawTar } from './helpers.js'

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

/**
 * Collects the names of a walk's entries, in order.
 * @param entries {AsyncIterable<TarEntry>}
 * @returns {Promise<string[]>}
 */
async function namesOf(entries: AsyncIterable<TarEntry>): Promise<string[]> {
  const names: string[] = []
  for await (const entry of entries) {
    names.push(entry.name)
  }
  return names
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
      // Node delivers the warning on a later tick than the one that added the
      // listener, so wait for it before detaching.
      await new Promise(resolve => setTimeout(resolve, 0))
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

  it('walks past an entry whose bytes were never read', async () => {
    const bytes = await packRawTar([
      { name: 'skipped.bin', body: new Uint8Array(1024 * 1024) },
      { name: 'after.txt', body: 'after' }
    ])
    const read: string[] = []
    for await (const entry of tarEntries(bytes)) {
      if (entry.name === 'after.txt') {
        read.push(new TextDecoder().decode(await entry.bytes()))
      }
    }
    expect(read).toEqual(['after'])
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
    expect(fileName).toBe('r.index%2Ehtml.text%2Fhtml.html')
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
    // A body large enough that the source is not already exhausted by the
    // time the archive is opened, so only the release can close it.
    const bytes = await collectBytes(
      await packSpaceArchive({
        spaceId: 's1',
        entries: [{ name: '.space.s1.json', bytes: new Uint8Array(400_000) }]
      })
    )
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
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(closed).toBe(false)
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

  it("parses the writer's own space/ directory entry as spaceRoot", () => {
    expect(parseArchivePath('space/')).toEqual({ area: 'spaceRoot' })
    // A bare file named `space` (no trailing slash) matches nothing in the
    // layout.
    expect(parseArchivePath('space')).toEqual({ area: 'other' })
  })

  it('parses a directory that is not a chunk directory as other', () => {
    // A directory nested in a Collection dir under a non-chunk-dir name.
    expect(parseArchivePath('space/s/c/d1/')).toEqual({ area: 'other' })
    // A directory nested inside a chunk directory.
    expect(parseArchivePath('space/s/c/.chunks.x/d1/')).toEqual({
      area: 'other'
    })
  })

  it('parses revocations entries as flat files only', () => {
    expect(parseArchivePath('revocations/')).toEqual({
      area: 'revocations',
      fileName: ''
    })
    expect(parseArchivePath('revocations/r1.json')).toEqual({
      area: 'revocations',
      fileName: 'r1.json'
    })
    expect(parseArchivePath('revocations/d1/')).toEqual({ area: 'other' })
    expect(parseArchivePath('revocations/d1/r1.json')).toEqual({
      area: 'other'
    })
  })

  it.each<{ label: string; entries: ArchiveEntry[]; refusal: RegExp }>([
    {
      label:
        'a directory in a Collection dir whose name is not a chunk directory',
      entries: [{ name: 'c1', files: [{ name: 'd1', files: [] }] }],
      refusal: /"space\/s1\/c1\/d1\/" is nested deeper than the layout goes/
    },
    {
      label: 'a directory inside a chunk directory',
      entries: [
        {
          name: 'c1',
          files: [
            { name: '.chunks.note%2E1', files: [{ name: 'sub', files: [] }] }
          ]
        }
      ],
      refusal:
        /"space\/s1\/c1\/\.chunks\.note%2E1\/sub\/" is nested deeper than the layout goes/
    },
    {
      label: 'an entry with an empty name',
      entries: [{ name: '', bytes: new Uint8Array(1) }],
      refusal: /name "" is not a single path segment/
    },
    {
      label: 'an entry name embedding a "/"',
      entries: [{ name: 'a/b', bytes: new Uint8Array(1) }],
      refusal: /name "a\/b" is not a single path segment/
    }
  ])(
    'refuses an entry tree the reader could not place: $label',
    async ({ entries, refusal }) => {
      await expect(
        packSpaceArchive({ spaceId: 's1', entries })
      ).rejects.toThrow(refusal)
    }
  )

  it('parses every entry of a valid packed archive to a non-other area', async () => {
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
          ],
          revocations: [{ name: 'r1.json', bytes }]
        })
      )
    )

    const areas: string[] = []
    for await (const entry of archive.entries) {
      areas.push(parseArchivePath(entry.name).area)
    }
    expect(areas).toEqual([
      'spaceRoot',
      'space',
      'collection',
      'chunk',
      'chunk',
      'chunk',
      'collection',
      'revocations',
      'revocations'
    ])
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

  it('writes service.json immediately after the manifest and reads it back', async () => {
    const service = {
      url: 'https://was.example/service',
      specs: {
        'https://example/was': [{ version: '0.9', features: ['export'] }]
      }
    }
    const bytes = await collectBytes(
      await packSpaceArchive({
        spaceId: 's1',
        entries: [{ name: '.space.s1.json', bytes: new Uint8Array() }],
        service
      })
    )
    const names: string[] = []
    for await (const entry of tarEntries(bytes)) {
      names.push(entry.name)
    }
    expect(names.slice(0, 2)).toEqual(['manifest.yml', 'service.json'])
    expect(parseArchivePath('service.json')).toEqual({ area: 'service' })

    const archive = await readSpaceArchive(bytes)
    expect(archive.service).toEqual(service)
    // The description is not named in the manifest, which describes the Space.
    expect(Object.keys(archive.manifest.contents)).not.toContain('service.json')
    const entryNames: string[] = []
    for await (const entry of archive.entries) {
      entryNames.push(entry.name)
    }
    expect(entryNames).toEqual([
      'space/',
      'space/s1/',
      'space/s1/.space.s1.json'
    ])
  })

  it('reads an archive carrying no service.json, yielding every entry once', async () => {
    const archive = await readSpaceArchive(await packFixtureArchive())
    expect(archive.service).toBeUndefined()
    const names: string[] = []
    const first = new Map<string, Uint8Array>()
    for await (const entry of archive.entries) {
      names.push(entry.name)
      if (entry.type === 'file' && !first.has(entry.name)) {
        first.set(entry.name, await entry.bytes())
      }
    }
    expect(names[0]).toBe('space/')
    expect(new Set(names).size).toBe(names.length)
    expect(
      JSON.parse(
        new TextDecoder().decode(
          first.get(`space/${FIXTURE_SPACE_ID}/.space.${FIXTURE_SPACE_ID}.json`)
        )
      ).id
    ).toBe(FIXTURE_SPACE_ID)
  })

  it('refuses a service.json that is not JSON', async () => {
    const bytes = await packRawTar([
      {
        name: 'manifest.yml',
        body: YAML.stringify({
          'ubc-version': '0.1',
          contents: { space: { contents: { s1: {} } } }
        })
      },
      { name: 'service.json', body: 'not json' }
    ])
    await expect(readSpaceArchive(bytes)).rejects.toThrow(
      /"service.json" is not valid JSON/
    )
  })

  it.each(['[]', 'null', '"text"', '42'])(
    'refuses a service.json that is not a JSON object: %s',
    async body => {
      const bytes = await packRawTar([
        {
          name: 'manifest.yml',
          body: YAML.stringify({
            'ubc-version': '0.1',
            contents: { space: { contents: { s1: {} } } }
          })
        },
        { name: 'service.json', body }
      ])
      await expect(readSpaceArchive(bytes)).rejects.toThrow(
        /"service.json" is not an object/
      )
    }
  )

  it('passes on a non-file entry named service.json as content', async () => {
    const bytes = await packRawTar([
      {
        name: 'manifest.yml',
        body: YAML.stringify({
          'ubc-version': '0.1',
          contents: { space: { contents: { s1: {} } } }
        })
      },
      {
        name: 'service.json',
        header: { type: 'symlink', linkname: 'elsewhere' }
      }
    ])
    const archive = await readSpaceArchive(bytes)
    expect(archive.service).toBeUndefined()
    const entries: { name: string; type: string }[] = []
    for await (const entry of archive.entries) {
      entries.push({ name: entry.name, type: entry.type })
    }
    expect(entries).toEqual([{ name: 'service.json', type: 'symlink' }])
  })

  it('refuses a Service Description JSON cannot represent, before packing', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const entries = [{ name: '.space.s1.json', bytes: new Uint8Array() }]
    await expect(
      packSpaceArchive({ spaceId: 's1', entries, service: circular })
    ).rejects.toThrow(/cannot be serialized as "service.json"/)
    await expect(
      packSpaceArchive({ spaceId: 's1', entries, service: () => {} })
    ).rejects.toThrow(/cannot be serialized as "service.json"/)
  })

  it('writes provenance.jsonl and did.jsonl after service.json, lists them, and reads them back verbatim', async () => {
    const provenance = new TextEncoder().encode('{"id":"a"}\n{"id":"b"}\n')
    const didLog = new TextEncoder().encode('{"versionId":"1-x"}\n')
    const bytes = await collectBytes(
      await packSpaceArchive({
        spaceId: 's1',
        entries: [{ name: '.space.s1.json', bytes: new Uint8Array() }],
        service: { url: 'https://was.example/service' },
        provenance,
        didLog
      })
    )
    const names = await namesOf(tarEntries(bytes))
    expect(names.slice(0, 5)).toEqual([
      'manifest.yml',
      'service.json',
      'provenance.jsonl',
      'did.jsonl',
      'space/'
    ])
    expect(parseArchivePath('provenance.jsonl')).toEqual({
      area: 'provenance'
    })
    expect(parseArchivePath('did.jsonl')).toEqual({ area: 'didLog' })
    expect(parseArchivePath('did.jsonl/')).toEqual({ area: 'other' })

    const archive = await readSpaceArchive(bytes)
    expect(archive.service).toEqual({ url: 'https://was.example/service' })
    expect(archive.provenance).toEqual(provenance)
    expect(archive.didLog).toEqual(didLog)
    // Both are listed in the manifest, right after its own entry.
    expect(Object.keys(archive.manifest.contents).slice(0, 3)).toEqual([
      'manifest.yml',
      'provenance.jsonl',
      'did.jsonl'
    ])
    const entryNames = await namesOf(archive.entries)
    expect(entryNames).toEqual([
      'space/',
      'space/s1/',
      'space/s1/.space.s1.json'
    ])
  })

  it('reads provenance entries from an archive carrying no service.json', async () => {
    const archive = await readSpaceArchive(await packProvenanceFixtureArchive())
    const inputs = provenanceFixtureInputs()
    expect(archive.service).toBeUndefined()
    expect(archive.provenance).toEqual(new Uint8Array(inputs.provenance))
    expect(archive.didLog).toEqual(new Uint8Array(inputs.didLog))
    const names = await namesOf(archive.entries)
    expect(names[0]).toBe('space/')
  })

  it('leaves both entries out of the archive and its manifest when not given', async () => {
    const archive = await readSpaceArchive(await packFixtureArchive())
    expect(archive.provenance).toBeUndefined()
    expect(archive.didLog).toBeUndefined()
    expect(Object.keys(archive.manifest.contents)).not.toContain(
      'provenance.jsonl'
    )
    expect(Object.keys(archive.manifest.contents)).not.toContain('did.jsonl')
    await archive.close()
  })

  it('passes on a root entry out of order, or not a file, as content', async () => {
    const manifest = YAML.stringify({
      'ubc-version': '0.1',
      contents: { space: { contents: { s1: {} } } }
    })
    const outOfOrder = await readSpaceArchive(
      await packRawTar([
        { name: 'manifest.yml', body: manifest },
        { name: 'did.jsonl', body: 'log' },
        { name: 'provenance.jsonl', body: 'statements' }
      ])
    )
    expect(outOfOrder.didLog).toEqual(new TextEncoder().encode('log'))
    expect(outOfOrder.provenance).toBeUndefined()
    const rest = await namesOf(outOfOrder.entries)
    expect(rest).toEqual(['provenance.jsonl'])

    const symlink = await readSpaceArchive(
      await packRawTar([
        { name: 'manifest.yml', body: manifest },
        {
          name: 'provenance.jsonl',
          header: { type: 'symlink', linkname: 'elsewhere' }
        }
      ])
    )
    expect(symlink.provenance).toBeUndefined()
    const entries = await namesOf(symlink.entries)
    expect(entries).toEqual(['provenance.jsonl'])
  })

  it('reproduces the checked-in provenance fixture archive', async () => {
    const checkedIn = fs.readFileSync(provenanceFixtureArchivePath())
    const packed = await packProvenanceFixtureArchive()
    expect(Buffer.from(packed).equals(checkedIn)).toBe(true)
  })

  it('is byte-reproducible across two packs made at different times', async () => {
    // Only the clock is faked: a tar header's mtime has one-second resolution,
    // so two packs made back to back would agree whatever the packer stamped.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const first = await packFixtureArchive()
      vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
      const second = await packFixtureArchive()
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reproduces the checked-in fixture archive', async () => {
    const checkedIn = fs.readFileSync(fixtureArchivePath())
    const packed = await packFixtureArchive()
    expect(Buffer.from(packed).equals(checkedIn)).toBe(true)
  })
})
