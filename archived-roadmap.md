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
