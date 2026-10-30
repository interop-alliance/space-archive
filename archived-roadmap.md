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
  - portable-web-spaces-spec: shipped -- the note under the archive endpoints
    now lists all five anchors the manifest names
  - portable-wallet-profile-spec: unresolved -- the normative layout text does
    not quote the manifest's `url` values
  - wallet-backup: unaffected -- it reads the manifest's structure and never
    compares the `url` strings
- acceptance:
  - [x] all five WAS constants name
        `https://w3c-ccg.github.io/portable-web-spaces-spec/`
  - [x] every anchor the five name exists as a `{#id}` heading in the spec
  - [x] the checked-in fixture's manifest carries the corrected URLs and
        regenerates byte-reproducibly
  - [x] the server's counterpart fixture test passes unchanged

Context: the five WAS constants named the host
`https://digitalcredentials.github.io/portable-web-spaces-spec/`, which the spec
is not rendered at, and two of their anchors -- `#collection-data-model` and
`#policy` -- named no heading in the spec at all. The corrected anchors are
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

### SAR-1: Reserve the Space id `policy` across the contract's parties

- status: done 2026-10-27 (superseded by SAR-8)
- priority: medium
- labels: contract, file-naming
- touches:
  - space-archive (this repo): shipped -- writer-side refusal in
    `spaceMetadataFileName` and `packSpaceArchive` (via
    `assertSpaceIdNotReserved`), the exported `RESERVED_SPACE_ID`, and this
    repo's ARCHITECTURE.md (Glossary entry, invariant notes)
  - portable-wallet-profile-spec: unresolved -- the normative layout text does
    not state the reservation
  - was-teaching-server: unresolved -- Space creation does not refuse the id
    `policy`; its ARCHITECTURE.md / AGENTS.md
  - wallet-backup: unresolved -- likely unaffected (it only reads Space archives
    back), left open for confirmation
- acceptance:
  - [x] space-archive refuses the reserved Space id `policy` on the writing side
        and exports `RESERVED_SPACE_ID`
  - [ ] portable-wallet-profile-spec's normative layout text states that the
        Space id `policy` is reserved
  - [ ] was-teaching-server refuses creating a Space with the id `policy`, and
        its ARCHITECTURE.md / AGENTS.md say so
  - [ ] wallet-backup's impact is confirmed and its `touches:` entry above is
        resolved (shipped or waived as unaffected)

Context: the per-Space archive's file-name dialect names a Space's Metadata file
`.space.<spaceId>.json`. When the Space id is `policy`, that name collides with
the Space's own policy file, `.space.policy.json`. This package now refuses the
id `policy` on the writing side (`spaceMetadataFileName`, `packSpaceArchive`)
and exports `RESERVED_SPACE_ID` so a caller can check ahead of time. The
reservation is not yet consistent across the parties that share this contract.
The PWS reference server already reserves `policy` for Collection and Resource
ids but not for Space ids, so a Space named `policy` can still be created there
today, even though it can no longer be exported as a per-Space archive. The
portable-wallet-profile-spec's normative layout text does not mention the
reservation at all. `wallet-backup` only reads Space archives back, so it is
likely unaffected, but that is unconfirmed.

Closed 2026-10-27 as superseded by SAR-8, which removed the collision by
renaming the Metadata file to `.space.meta.<spaceId>.json`; the reservation this
item shipped was taken back out, and its open boxes are unmet by design.

### SAR-8: Rename the Space and Collection Metadata files to `.<level>.meta.<id>.json`

- status: done 2026-10-27
- priority: medium
- labels: contract, file-naming, archive-layout, writer, reader, metadata-file
- touches:
  - space-archive (this repo): shipped 2026-10-27, unpublished (0.10.0) --
    `SPACE_FILE_PREFIX` / `COLLECTION_FILE_PREFIX` and the builders and parsers
    in `src/archive/resourceFileName.ts`, removal of `RESERVED_SPACE_ID` /
    `assertSpaceIdNotReserved` and of the policy-name exclusion in both Metadata
    parsers, the regenerated `fixtures/space-archive.tar` and
    `fixtures/space-archive-provenance.tar`, ARCHITECTURE.md (archive layout
    map, Glossary: Reserved Space id removed, Reserved Collection id reworded),
    README, the breaking CHANGELOG entry
  - was-teaching-server: shipped 2026-10-27 as its WAS-233 (0.43.0 TBD) -- the
    filesystem store's on-disk names follow the package's builders, so it gained
    layout step 9 (refuses a store holding a Metadata file under an old name);
    the import, export provenance, Space projection and tombstone modules, the
    counterpart fixture test, ARCHITECTURE.md and its `docs/` layout pages name
    the new files; consumes this package through a temporary `link:` until
    0.10.0 is published
  - wallet-backup: shipped 2026-10-27 (0.8.0 TBD) -- its source does not build
    or parse either file name directly (it goes through `readSpaceArchive` and
    the classifier helpers); `test/browser/bundle.spec.ts` now packs and asserts
    `.space.meta.zBrowserSpace.json`, the dependency range is `^0.10.0`, and the
    CHANGELOG names the breaking bump; its ARCHITECTURE.md / AGENTS.md never
    named the old files
  - unaffected: portable-wallet-profile-spec (the per-Space archive's internal
    layout section is not yet carried in the current profile version, so there
    is no normative file-name text to change; waived 2026-10-27)
- acceptance:
  - [x] The Space Metadata file is written and read as
        `.space.meta.<spaceId>.json`, and the Collection Metadata file (live in
        the Collection directory, tombstone in the Space directory) as
        `.collection.meta.<collectionId>.json`
  - [x] `RESERVED_SPACE_ID` and `assertSpaceIdNotReserved` are removed; a Space
        id of `policy` packs and reads back
  - [x] `RESERVED_COLLECTION_ID` stays, justified by the PWS reserved path
        segment registry alone, and its Glossary entry no longer cites a
        file-name collision
  - [x] Both checked-in fixtures are regenerated and the server's counterpart
        test passes against them (2026-10-27)
  - [x] Every `touches:` entry above is resolved (2026-10-27)
  - [x] SAR-1 is closed as superseded by this item (2026-10-27)

Context: the Space Metadata file is named `.space.<spaceId>.json` and the
Space's own policy file `.space.policy.json`, so a Space id of `policy` would
give both objects one file name. SAR-1 handles that by reserving the id, which
only this package enforces; the server still creates such a Space and the spec
has no text to back the reservation. Renaming the Metadata file to
`.space.meta.<spaceId>.json` removes the collision instead, so no id needs
reserving at the Space level and the reader no longer has to exclude the policy
name before parsing. The `.meta.` segment echoes the existing Resource sidecar
prefix (`.meta.<resourceId>.json`). The Collection Metadata file has the same
collision with `.collection.policy.json`, but the Collection id `policy` stays
reserved regardless because the PWS spec's reserved path segment registry
reserves it; it is renamed to `.collection.meta.<collectionId>.json` in the same
change so both levels follow one pattern, and its Glossary entry then rests on
the registry alone. The Space id in the file name is redundant with the
`space/<spaceId>/` directory, but the server's importer reads the source Space
id from the file name and cross-checks it against the directory, so the
id-bearing form keeps that check intact. This is a change to the layout's shape,
so it is a full pass over the "Parties to this contract" table in AGENTS.md and
a breaking release of this package.

### SAR-10: Provenance fixture carries `didVersionId`

- status: done 2026-10-29
- priority: medium
- labels: contract, provenance, fixtures
- discovered-from: portable-web-spaces-spec WASS-7 (2026-10-29)
- touches:
  - space-archive (this repo): shipped 2026-10-29, unpublished (0.11.0) --
    `provenance.jsonl` re-signed by the server's export of the tree, both
    fixture archives repacked; nothing in `src/`, `test/`, `generate.ts` or
    ARCHITECTURE.md named the member, so no other edit; CHANGELOG.md
  - was-teaching-server: WAS-236 shipped 2026-10-29 (the writer and verifier of
    the member, and the only signer that can regenerate the fixture)
  - wallet-backup: unaffected (it does not verify provenance and names no
    statement member)
  - portable-web-spaces-spec: resolved 2026-10-29 -- the Archive provenance
    section and the did:webvh archive signer profile use `didVersionId`
- acceptance:
  - [x] the checked-in `provenance.jsonl` statements carry `didVersionId` and no
        `didLogVersionId`, with proofs that verify over the renamed member
  - [x] `generate.ts` writes the new member when it regenerates the fixture (it
        packs the checked-in body verbatim)
  - [x] nothing in `src/` or `test/` names `didLogVersionId`
  - [x] CHANGELOG entry names the fixture regeneration

Context: each provenance statement in an export names the version of the signing
DID's document that lists the signing key. The member was `didLogVersionId`,
which is did:webvh vocabulary. The PWS spec made the provenance text
method-neutral on 2026-10-29 and renamed the member to `didVersionId`, leaving
the did:webvh meaning (the log entry's `versionId`) to a signer profile in the
spec's DID method registry. The fixture archive carries signed statements under
the old name. A rename changes the signed bytes, so the fixture cannot be edited
in place. It has to be re-signed by the reference server once that server writes
the new member.

### SAR-9: Align the manifest's url values with the PWS spec

- status: done 2026-10-29
- priority: medium
- labels: contract, manifest, writer
- discovered-from: portable-web-spaces-spec WASS review of the Space Archive
  Format section (2026-10-29)
- touches:
  - space-archive (this repo): shipped 2026-10-29 -- `MANIFEST_URL` replaces
    `UBC_MANIFEST_URL`, `RESOURCE_URL` is removed, and all five URLs in
    `src/archive/manifestUrls.ts` are `https://w3id.org/pws#<anchor>`; the
    module comment names the PWS spec as their source;
    `test/node/archive.test.ts` asserts the manifest's own entry; both fixtures
    repacked; ARCHITECTURE.md (layout table, invariant 5, Glossary) and
    CHANGELOG.md updated
  - was-teaching-server: handed off 2026-10-29 to WAS-237 -- it packs through
    `packSpaceArchive`, so its exports follow this change on upgrade, but
    `test/storage.test.ts:183` asserts the old `github.io` Spaces URL and its
    counterpart fixture test compares against the repacked fixtures; both need
    the new version; its ARCHITECTURE.md. That item tracks the work in its own
    repo and waits on this package's 0.11.0 publish
  - wallet-backup: handed off 2026-10-29 to WBU-12 -- its reader is unaffected
    (the manifest is descriptive and entries are classified by path), but
    `src/bundle/manifest.ts` imports `UBC_MANIFEST_URL` (renamed `MANIFEST_URL`
    here) as the `url` of the outer bundle's own `manifest.yml` entry, and
    `test/node/bundle.test.ts:245` asserts the FEP URL. Which URL the bundle
    manifest cites is that repo's wire decision (the bundle layout is not the
    PWS archive); its AGENTS.md. That item tracks the work in its own repo and
    waits on this package's 0.11.0 publish
  - portable-web-spaces-spec: resolved 2026-10-29 -- the Space Archive Format
    section's manifest example and root `contents` prose name the spec's own
    Archive manifest section as the `manifest.yml` entry's `url`, list a
    Resource representation as a bare name, and drop `#resource-data-model` from
    the permanent-anchor lists; the FEP is now only an editorial note crediting
    the inspiration
- acceptance:
  - [x] the packer writes `https://w3id.org/pws#archive-manifest` as the `url`
        of the `manifest.yml` entry, and no FEP URL appears in the archive (the
        host changed from the rendered `github.io` location to the spec
        identifier when the spec settled on 2026-10-29 that every `url` is the
        identifier plus the section anchor; the other four URLs moved with it)
  - [x] the packer lists a Resource representation entry as a bare name, with no
        `url`, and `RESOURCE_URL` is removed
  - [x] `src/archive/manifestUrls.ts` no longer names FEP-6fcd, and its module
        comment states that the PWS spec, not the server, is the source of the
        documenting URLs
  - [x] a test asserts the manifest's own entry carries the spec URL
  - [x] ARCHITECTURE.md describes the manifest as the PWS archive manifest
        rather than "the UBC v0.1 manifest"
  - [x] the CHANGELOG entry names the change as wire text that readers of older
        archives may still see under the FEP URL

Context: the `manifest.yml` entry in every exported archive carries a `url` that
names the section of a specification describing it. Today that URL points at the
manifest-file section of FEP-6fcd, the Fediverse Enhancement Proposal whose
Unified Backup Container layout the archive format was modelled on. The PWS spec
now defines the archive format itself, in its Space Archive Format section, and
keeps the FEP only as an editorial note on where the layout came from. The FEP
is an unofficial draft in a community repository, so an archive should not cite
it as the specification of its own manifest. The spec's manifest example and
prose already name the spec's Archive manifest section as that `url`, so the
packer disagrees with the spec until this lands.

The `ubc-version` member stays. The spec keeps it, with the value `"0.1"`, as
the one thing retained from the FEP draft. The spec also stopped giving a
Resource representation entry a `url`: a representation is user content whose
shape the spec does not define, so the spec lists it as a bare name and no
longer counts `#resource-data-model` among the anchors the manifest keeps
permanent. The packer writes `RESOURCE_URL` on every representation today, so
that goes too. The other four documenting URLs (Spaces, Collection Metadata,
Resource Metadata, policy) already pointed at the PWS spec, but at its rendered
`w3c-ccg.github.io` location. On 2026-10-29 the spec settled that every `url` is
the spec identifier plus the section anchor, so those four move to
`https://w3id.org/pws#<anchor>` as well.

This is a wire-text change. An archive written before it carries the FEP URL and
the `github.io` URLs; one written after carries the `w3id.org` URLs. The reader
does not check the manifest's `url` values (the manifest is descriptive and
entries are classified by path), so both archives read the same way, but a
consumer that compares manifests byte for byte will see the difference. Older
archives are not rewritten.
