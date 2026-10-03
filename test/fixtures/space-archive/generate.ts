/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
/**
 * Generator for the checked-in Space archive fixture: a small fixed entry tree
 * packed by this package's own writer. Run it with
 * `npx tsx test/fixtures/space-archive/generate.ts` to rewrite the tar, which
 * lives at `fixtures/space-archive.tar` under the package root.
 *
 * The fixture exists so a counterpart test in another implementation (the WAS
 * reference server, which builds these trees out of its two storage backends)
 * can assert its export of the same tree is byte-identical to this one. It is
 * published with the package, reachable as the subpath export
 * `@interop/space-archive/fixtures/space-archive.tar`, so a counterpart test
 * pins against the bytes of the version it depends on rather than against a
 * checkout it has to find on disk. The tree is fixed and deliberately boring:
 * one Space Metadata
 * dot-file, one Collection holding its Metadata, its governing history log, a
 * Resource representation and that Resource's metadata sidecar, and one
 * Space-scoped revocation record.
 *
 * Each record has the layout the WAS reference server exports. The two
 * Metadata files, the governing history log record and the Resource sidecar
 * carry a write stamp (`updatedAt`, `updatedAtCounter`, `originId`), in the
 * member order the server writes. The sidecar also carries its `/meta`
 * record's stamp and generation under `meta`. Every stamp is the epoch with
 * counter 0 and the origin id `zFixtureOrigin`. A Metadata file embeds its
 * generation as `_generation`, and the log record and the sidecar carry theirs
 * as `generation`. The revocation record is a stub and carries no stamp, as a
 * stored revocation has none.
 *
 * The fixture carries no `service.json`. A Service Description belongs to the
 * exporting deployment rather than to the layout, so putting one here would pin
 * a server version and a feature list into the tree the counterpart test
 * stages. The entry's position is pinned by a node test instead.
 *
 * A second fixture, `fixtures/space-archive-provenance.tar`, packs the same
 * tree with the two provenance root entries beside the manifest:
 * `provenance.jsonl` and `did.jsonl`. Their bodies are checked in beside this
 * file and packed verbatim, since this package neither signs nor verifies.
 * They were written by the WAS reference server exporting this tree at
 * `https://was.example` with the export-signing key derived from the 32-byte
 * seed of all `0x01` bytes, under a `did:webvh` log whose update key is the
 * `did:key` of the all-`0x02` seed. That log is a single `createDID` entry
 * made at `2026-09-30T23:40:34Z`, and it reproduces byte for byte under that
 * clock. The server's counterpart test re-exports the tree under the same seed
 * and log and asserts the same bytes.
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
 * This generator's directory, the base of every fixture path below.
 */
const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * The fixture archive's path, relative to this directory: it lives under the
 * package root's `fixtures/`, the directory the package publishes.
 */
const FIXTURE_ARCHIVE_FILE = '../../../fixtures/space-archive.tar'

/**
 * The write stamp every stamped record in the fixture carries: the epoch, the
 * counter at 0, and a fixture origin id.
 */
const FIXTURE_STAMP = {
  updatedAt: '1970-01-01T00:00:00.000Z',
  updatedAtCounter: 0,
  originId: 'zFixtureOrigin'
}

/**
 * The provenance fixture archive's path, relative to this directory.
 */
const PROVENANCE_FIXTURE_ARCHIVE_FILE =
  '../../../fixtures/space-archive-provenance.tar'

/**
 * The checked-in `provenance.jsonl` and `did.jsonl` bodies the provenance
 * fixture packs, relative to this directory.
 */
const PROVENANCE_INPUT_FILE = 'provenance.jsonl'
const DID_LOG_INPUT_FILE = 'did.jsonl'

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
        ...FIXTURE_STAMP,
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
        ],
        _generation: 'zFixtureSpaceGeneration'
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
            ...FIXTURE_STAMP,
            _generation: 'zFixtureNotesGeneration'
          }
        }),
        // The governing history log travels as the server's stored record --
        // the JSON Lines body beside the generation and write stamp it was
        // served under -- not as the bare body.
        jsonFile({
          name: `.collectionlog.${FIXTURE_COLLECTION_ID}.json`,
          document: {
            generation: 'zFixtureLogGeneration',
            ...FIXTURE_STAMP,
            body: `${JSON.stringify({
              state: { type: 'WasEpochConfiguration', scheme: 'edv' }
            })}\n`
          }
        }),
        // The sidecar holds the content record's stamp and generation, and
        // the `/meta` record's own under `meta`.
        jsonFile({
          name: `.meta.${FIXTURE_RESOURCE_ID}.json`,
          document: {
            createdAt: '1970-01-01T00:00:00.000Z',
            ...FIXTURE_STAMP,
            generation: 'zFixtureNoteGeneration',
            meta: {
              ...FIXTURE_STAMP,
              generation: 'zFixtureNoteMetaGeneration'
            },
            custom: { title: 'A note' }
          }
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
 * Reads one file checked in beside this generator.
 * @param name {string}
 * @returns {Uint8Array}
 */
function readInput(name: string): Uint8Array {
  return fs.readFileSync(path.join(FIXTURE_DIR, name))
}

/**
 * The checked-in `provenance.jsonl` and `did.jsonl` bodies the provenance
 * fixture carries.
 * @returns {{ provenance: Uint8Array, didLog: Uint8Array }}
 */
export function provenanceFixtureInputs(): {
  provenance: Uint8Array
  didLog: Uint8Array
} {
  return {
    provenance: readInput(PROVENANCE_INPUT_FILE),
    didLog: readInput(DID_LOG_INPUT_FILE)
  }
}

/**
 * Packs the provenance fixture archive into its bytes: the fixture tree plus
 * the checked-in `provenance.jsonl` and `did.jsonl` bodies.
 * @returns {Promise<Uint8Array>}
 */
export async function packProvenanceFixtureArchive(): Promise<Uint8Array> {
  const pack = await packSpaceArchive({
    spaceId: FIXTURE_SPACE_ID,
    entries: fixtureEntries(),
    revocations: fixtureRevocations(),
    ...provenanceFixtureInputs()
  })
  return collectBytes(pack)
}

/**
 * The checked-in fixture's absolute path.
 * @returns {string}
 */
export function fixtureArchivePath(): string {
  return path.join(FIXTURE_DIR, FIXTURE_ARCHIVE_FILE)
}

/**
 * The checked-in provenance fixture's absolute path.
 * @returns {string}
 */
export function provenanceFixtureArchivePath(): string {
  return path.join(FIXTURE_DIR, PROVENANCE_FIXTURE_ARCHIVE_FILE)
}

/**
 * Rewrites the two checked-in fixtures. Only runs when this module is the
 * entry point, so importing it from a test costs nothing.
 * @returns {Promise<void>}
 */
async function main(): Promise<void> {
  fs.writeFileSync(fixtureArchivePath(), await packFixtureArchive())
  fs.writeFileSync(
    provenanceFixtureArchivePath(),
    await packProvenanceFixtureArchive()
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
