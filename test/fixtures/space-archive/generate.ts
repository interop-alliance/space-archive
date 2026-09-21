/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Generator for the checked-in Space archive fixture: a small fixed entry tree
 * packed by this package's own writer. Run it with
 * `npx tsx test/fixtures/space-archive/generate.ts` to rewrite the tar.
 *
 * The fixture exists so a counterpart test in another implementation (the WAS
 * reference server, which builds these trees out of its two storage backends)
 * can assert its export of the same tree is byte-identical to this one. The
 * tree is therefore fixed and deliberately boring: one Space Metadata
 * dot-file, one Collection holding its Metadata, its governing history log, a
 * Resource representation and that Resource's metadata sidecar, and one
 * Space-scoped revocation record.
 *
 * The fixture carries no `service.json`. A Service Description belongs to the
 * exporting deployment rather than to the layout, so putting one here would pin
 * a server version and a feature list into the tree the counterpart test
 * stages. The entry's position is pinned by a node test instead.
 *
 * Every file name in the tree is written out literally and none comes from the
 * file-name codec's builders. The fixture pins the names on the wire, so it
 * stays independent of the code it checks. A node test asserts each builder
 * against the same literal names.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectBytes, packSpaceArchive } from '../../../src/index.js'
import type { ArchiveEntry, ArchiveFile } from '../../../src/index.js'

/**
 * The fixture Space's id.
 */
export const FIXTURE_SPACE_ID = 'zFixtureSpace'

/**
 * The fixture Collection's id.
 */
export const FIXTURE_COLLECTION_ID = 'notes'

/**
 * The fixture Resource's id -- dotted on purpose, so the file-name codec's
 * dot-escaping is exercised by the fixture itself.
 */
export const FIXTURE_RESOURCE_ID = 'note.1'

/**
 * The fixture Resource's representation file name, with the dotted id and the
 * content type dot-escaped.
 */
export const FIXTURE_REPRESENTATION_FILE_NAME =
  'r.note%2E1.application%2Fjson.json'

/**
 * The fixture archive's file name, relative to this directory.
 */
const FIXTURE_ARCHIVE_FILE = 'space-archive.tar'

/**
 * Encodes one fixed JSON document as the bytes of an archive file.
 * @param options {object}
 * @param options.name {string}
 * @param options.document {object}
 * @returns {ArchiveFile}
 */
function jsonFile({
  name,
  document
}: {
  name: string
  document: object
}): ArchiveFile {
  return { name, bytes: new TextEncoder().encode(JSON.stringify(document)) }
}

/**
 * The fixture's top-level entry tree, in pack order.
 * @returns {ArchiveEntry[]}
 */
function fixtureEntries(): ArchiveEntry[] {
  return [
    jsonFile({
      name: `.space.${FIXTURE_SPACE_ID}.json`,
      document: {
        id: FIXTURE_SPACE_ID,
        controller: 'did:key:z6MkfixtureController',
        type: ['Space'],
        // The Space Metadata entry travels as the object a server serves, so
        // it carries the server-derived `backends` listing. The counterpart
        // server exports a single server-configured filesystem backend, which
        // is what the fixture pins here.
        backends: [
          {
            id: 'default',
            name: 'Server Filesystem',
            managedBy: 'server',
            persistence: 'durable'
          }
        ]
      }
    }),
    {
      name: FIXTURE_COLLECTION_ID,
      files: [
        jsonFile({
          name: `.collection.${FIXTURE_COLLECTION_ID}.json`,
          document: {
            id: FIXTURE_COLLECTION_ID,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z'
          }
        }),
        // The governing history log travels as the server's stored record --
        // the JSON Lines body beside the validator it was served under -- not
        // as the bare body.
        jsonFile({
          name: `.collectionlog.${FIXTURE_COLLECTION_ID}.json`,
          document: {
            generation: 'zFixtureLogGeneration',
            version: 1,
            body: `${JSON.stringify({
              state: { type: 'WasEpochConfiguration', scheme: 'edv' }
            })}\n`
          }
        }),
        jsonFile({
          name: `.meta.${FIXTURE_RESOURCE_ID}.json`,
          document: { custom: { title: 'A note' } }
        }),
        jsonFile({
          name: FIXTURE_REPRESENTATION_FILE_NAME,
          document: { note: 'hello' }
        })
      ]
    }
  ]
}

/**
 * The fixture's Space-scoped revocation records, in pack order.
 * @returns {ArchiveFile[]}
 */
function fixtureRevocations(): ArchiveFile[] {
  return [
    jsonFile({
      name: 'urn%3Auuid%3Afixture-revocation.json',
      document: { id: 'urn:uuid:fixture-revocation' }
    })
  ]
}

/**
 * Packs the fixture archive into its bytes.
 * @returns {Promise<Uint8Array>}
 */
export async function packFixtureArchive(): Promise<Uint8Array> {
  const pack = await packSpaceArchive({
    spaceId: FIXTURE_SPACE_ID,
    entries: fixtureEntries(),
    revocations: fixtureRevocations()
  })
  return collectBytes(pack)
}

/**
 * The checked-in fixture's absolute path.
 * @returns {string}
 */
export function fixtureArchivePath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    FIXTURE_ARCHIVE_FILE
  )
}

/**
 * Rewrites the checked-in fixture. Only runs when this module is the entry
 * point, so importing it from a test costs nothing.
 * @returns {Promise<void>}
 */
async function main(): Promise<void> {
  const bytes = await packFixtureArchive()
  fs.writeFileSync(fixtureArchivePath(), bytes)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
