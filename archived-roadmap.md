# Space Archive Roadmap -- archived (completed) items

Completed items from [ROADMAP.md](ROADMAP.md), moved here verbatim when they
ship so that item-number references (SAR-N) in the active roadmap, commit
messages, and design docs keep resolving. Append-only: newest at the bottom; do
not rewrite or summarize items on the way in. Ids remain permanent and are never
reused. CHANGELOG.md stays the record of _what_ landed; this file preserves each
item's acceptance criteria and context.

---

### SAR-3: Carry the exporting server's Service Description in the archive

- status: done 2026-09-20
- priority: medium
- labels: contract, archive-layout, writer, reader
- touches:
  - space-archive (this repo): shipped -- `packSpaceArchive`'s optional
    `service` option and the `service.json` entry it writes,
    `SpaceArchive.service` on the reader, `ARCHIVE_SERVICE_FILE` and the
    `service` path area, and this repo's ARCHITECTURE.md (the new "Archive
    layout" section, invariant 2's fixture note, the Glossary entry) and README
  - was-teaching-server: shipped -- the Export Space handler builds the served
    Service Description and both backends pass it to `packSpaceArchive`;
    `importTar.ts` ignores the entry; its ARCHITECTURE.md / AGENTS.md
  - portable-wallet-profile-spec: unresolved -- the normative layout text does
    not state the `service.json` entry
  - wallet-backup: unresolved -- reader only, and the member is optional, so it
    is likely unaffected; left open for confirmation
- acceptance:
  - [x] `packSpaceArchive` writes `service.json` immediately after
        `manifest.yml` when given a Service Description, and writes none
        otherwise
  - [x] `readSpaceArchive` exposes it as `SpaceArchive.service`, `undefined`
        when the archive carries none
  - [x] tests pin the entry's position, the round trip, an archive without the
        entry, and the refusal of a `service.json` that is not a JSON object
  - [x] the WAS reference server's export carries the description it serves at
        its service-description route, and its import ignores the entry

Context: an account's Spaces may in future live on different servers, each
speaking its own WAS specification version and feature set. An importer reading
a per-Space archive today learns nothing about the server the contents were
written by, so it cannot decide what to do with them -- or refuse them -- before
it starts writing. The archive keeps its current tree and gains one entry beside
its `manifest.yml`: `service.json`, the exporting server's Service Description,
verbatim. It is informational on import; the reader exposes it and the importer
ignores it for now.

discovered-from: freewallet FW-530.

The checked-in fixture (`test/fixtures/space-archive/space-archive.tar`) was
deliberately NOT regenerated. A Service Description is the exporting
deployment's, not the layout's, so putting one in the fixture would pin a server
version and a feature list into the tree the server's counterpart test
(`test/space-archive-fixture.test.ts`) stages in a backend. The fixture keeps
pinning the entry-tree construction, and the new entry's position is pinned by a
node test instead.

---

### SAR-4: Correct the WAS spec URLs the archive manifest names

- status: done 2026-09-20
- priority: medium
- labels: contract, manifest, wire-text
- touches:
  - space-archive (this repo): shipped -- the five WAS constants in
    `src/archive/manifestUrls.ts`, the regenerated fixture
    `test/fixtures/space-archive/space-archive.tar`, and ARCHITECTURE.md's
    invariant 6
  - was-teaching-server: shipped -- no source change; the counterpart test
    `test/space-archive-fixture.test.ts` passes against the regenerated fixture,
    and the CHANGELOG records that exports now name the corrected URLs
  - wallet-attached-storage-spec: shipped -- the note under the archive
    endpoints now lists all five anchors the manifest names
  - portable-wallet-profile-spec: unresolved -- the normative layout text does
    not quote the manifest's `url` values
  - wallet-backup: unaffected -- it reads the manifest's structure and never
    compares the `url` strings
- acceptance:
  - [x] all five WAS constants name
        `https://w3c-ccg.github.io/wallet-attached-storage-spec/`
  - [x] every anchor the five name exists as a `{#id}` heading in the spec
  - [x] the checked-in fixture's manifest carries the corrected URLs and
        regenerates byte-reproducibly
  - [x] the server's counterpart fixture test passes unchanged

Context: the five WAS constants named the host
`https://digitalcredentials.github.io/wallet-attached-storage-spec/`, which the
spec is not rendered at, and two of their anchors -- `#collection-data-model`
and `#policy` -- named no heading in the spec at all. The corrected anchors are
`#collection-metadata-data-model` and `#access-control-policies`. The values are
permanent wire text, so this is a one-time correction of strings that resolved
nowhere rather than a rewrite following a spec that moved house.

discovered-from: freewallet FW-530.

---

### SAR-5: Carry the exporting server's provenance and DID log snapshot in the archive

- status: done 2026-09-30
- priority: medium
- labels: contract, archive-layout, writer, reader
- touches:
  - space-archive (this repo): shipped -- `packSpaceArchive`'s optional
    `provenance` and `didLog` options and the `provenance.jsonl` / `did.jsonl`
    entries they write, both listed in the manifest (`buildExportManifest`'s
    `provenance` / `didLog` flags), `SpaceArchive.provenance` and
    `SpaceArchive.didLog` on the reader, `ARCHIVE_PROVENANCE_FILE`,
    `ARCHIVE_DID_LOG_FILE` and the two path areas, the second published fixture
    `fixtures/space-archive-provenance.tar`, and this repo's ARCHITECTURE.md
    (archive layout, invariants 2 and 3, Glossary), AGENTS.md (parties table)
    and README
  - was-teaching-server: shipped -- both backends sign one statement per
    exported object into `provenance.jsonl` and embed the server's log snapshot
    as `did.jsonl` (its WAS-165); its counterpart test pins both entries against
    the new fixture
  - wallet-backup: unaffected -- it reads Space archives through
    `readSpaceArchive`, which consumes the new root entries before the walk it
    iterates, so its migration walk sees the same entries as before
  - portable-wallet-profile-spec: unaffected -- the profile does not yet carry
    the per-Space archive's internal layout section (PWP-4), so no normative
    text names the root entries
- acceptance:
  - [x] the packer writes `provenance.jsonl` and `did.jsonl` verbatim after
        `service.json`, each only when given, and lists both in the manifest
  - [x] the reader exposes both as bytes without parsing or verifying them, and
        opens an archive missing any of the root entries
  - [x] a second fixture carries both entries and regenerates byte-reproducibly,
        and is published as a subpath export
  - [x] the server's counterpart test reproduces the second fixture byte for
        byte

Context: the WAS reference server's export carries `createdBy` and the other
server-managed members of each object, but nothing authenticates them once the
archive leaves the server, so an import has to trust whatever the archive says.
The server now signs one statement per exported object and ships the history log
of its signing DID with them. The archive layout needs two root entries to hold
them: `provenance.jsonl`, the statements, and `did.jsonl`, the log snapshot.
Both sit beside `manifest.yml` and `service.json` and are listed in the
manifest. This codec only carries them. Verification is the importer's (the
server's import side, and any wallet that chooses to check).

discovered-from: was-teaching-server WAS-165.

The entries are listed in the manifest with no documenting `url`, since no
specification section describes either yet. Their bodies in the second fixture
were written by the server and are checked in beside the generator, since this
package holds no signing code.

### SAR-6: Retire the `_version` member and regenerate the fixtures for write stamps

- status: done 2026-10-03
- priority: medium
- labels: contract, metadata-file, fixtures
- discovered-from: was-teaching-server WAS-172 (2026-10-03)
- touches:
  - space-archive (this repo): shipped 2026-10-03, unpublished (0.6.0) --
    `metadataFile.ts` strips `_generation` alone, with its test and the README
    to match; `generate.ts` carries the write-stamp tree; `provenance.jsonl`
    rewritten from the server's export of it; `did.jsonl` reproduced byte for
    byte from the all-`0x02` seed and kept; both fixture archives regenerated;
    ARCHITECTURE.md (layer map, invariant 2, a Write stamp glossary entry) and
    CHANGELOG.md updated
  - was-teaching-server: shipped -- the provenance case in
    `test/space-archive-fixture.test.ts` consumes the republished fixture and
    runs as `it` again; the staged tree in that test follows the regenerated one
- acceptance:
  - [x] `metadataFile.ts` no longer names or strips `_version`; `_generation` is
        the one embedded validator member it removes
  - [x] `test/node/metadataFile.test.ts` and the README describe the Metadata
        file without `_version`
  - [x] the fixture tree in `generate.ts` carries the write-stamp layout the
        reference server exports (stamp members on each record, no `version`
        counter on the governing history log record)
  - [x] `provenance.jsonl` is rewritten from the reference server's export of
        that tree, under the seeds `generate.ts` documents. `did.jsonl` is
        reproduced byte for byte and stays unchanged. Both fixture archives are
        regenerated
  - [x] the server's counterpart test passes against the republished package
        with `it.fails` back to `it`

Context: the WAS reference server replaced its per-record version counters with
a write stamp (`updatedAt`, `updatedAtCounter`, `originId`). A Space or
Collection Metadata file it exports now embeds `_generation` alone. The stamp
members are wire members and sit in the body. This package still strips
`_version` beside `_generation` when it reads a Metadata file back. The strip is
harmless, but the code, its test, and the README describe a member no server
writes.

The fixtures predate the stamp as well. The tree in `generate.ts` has no stamp
members, and its governing history log record carries `version: 1`. The
checked-in `provenance.jsonl` statements attest the retired `version` claims. A
statement the server signs now attests the object's write stamp, and a
Resource's `meta` stamp, in their place. The server's export of the staged tree
therefore no longer matches `fixtures/space-archive-provenance.tar` byte for
byte, and its counterpart case is marked as expected to fail until this lands.

The Collection tombstone form is a separate dialect change, tracked by the
server's WAS-174.
