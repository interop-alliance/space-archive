# Space Archive Roadmap (open items)

nextAvailableId: 11

Status as of 2026-09-18. Uses the formalized item structure shared with the
freewallet and was-teaching-server roadmaps.

Scope: open work items only. This document tracks the **remaining** items;
completed items move verbatim to [archived-roadmap.md](archived-roadmap.md) as
they land, so SAR-N references keep resolving (CHANGELOG.md remains the record
of what landed).

## Item format

Each work item is a `### SAR-N: Title` heading followed by a field block and
free prose context. Ids are permanent and never reused; new items take the next
unused number regardless of section. Statuses: `todo`, `in-progress`, `draft`
(no actionable done-state yet -- blocked externally or a parking record); `done`
items move to [archived-roadmap.md](archived-roadmap.md) once shipped. Full
conventions live in [AGENTS.md](AGENTS.md) under "Roadmap & Task Conventions".

---

### SAR-2: Packer accepts trees the reader can't place

- status: todo
- priority: medium
- labels: contract, archive-layout, writer
- touches:
  - space-archive (this repo): unresolved -- `src/archive/exportTar.ts`,
    `src/archive/readSpaceArchive.ts`, and this repo's ARCHITECTURE.md (layer
    map, invariants)
  - was-teaching-server: unresolved -- both backends build the entry tree they
    hand to `packSpaceArchive`; confirm neither builds a tree the packer would
    now refuse; its ARCHITECTURE.md / AGENTS.md
  - wallet-backup: unresolved -- likely unaffected (reader only), left open for
    confirmation
  - portable-wallet-profile-spec: unresolved -- likely unaffected (the layout
    text already limits nesting to a chunk directory), left open for
    confirmation
- acceptance:
  - [ ] the archive path grammar has one definition that both the packer and
        `parseArchivePath` use
  - [ ] `packSpaceArchive` refuses an entry tree that its own reader would parse
        as `other` (a directory nested deeper than a chunk directory, a nested
        directory that is not a chunk directory)
  - [ ] the writer's own `space/` directory entry has a defined
        `parseArchivePath` result, and a test states it
  - [ ] a test packs each refused tree shape and asserts the refusal
  - [ ] ARCHITECTURE.md names the module that owns the path grammar

Context: the packer and the reader each carry their own copy of the archive's
path grammar, and the two copies disagree. The packer builds paths by joining
names as it walks the caller's entry tree. The tree type is recursive, so the
packer accepts any depth. The reader's `parseArchivePath` separately encodes the
root names, the trailing-slash rule, and a four-segment depth limit under
`space/`. A caller can therefore hand `packSpaceArchive` a tree that packs
without complaint and reads back as unclassified `other` entries. Neither side
raises an error, and no test covers the gap. The reference server is the caller
most likely to hit it, since it builds these trees from its storage backends.

discovered-from: the 2026-09-18 simplification review of the initial codec port.

Two concrete cases, both verified by running the code. First, a tree such as
`c1/d1/d2/f` packs as `space/s1/c1/d1/d2/f`, and `parseArchivePath` returns
`{ area: 'other' }` for it (`readSpaceArchive.ts`, the `rest.length > 4` check).
A nested directory whose name is not a `.chunks.<id>` name has the same outcome
one level up. Second, the packer's own `space/` directory entry (`exportTar.ts`,
`fillSpaceArchive`) parses as `{ area: 'other' }`, because the parser requires a
Space id segment.

Two approaches were considered. The smaller one is a shape check in the packer's
tree walk, so the packer refuses what the reader cannot place. The larger one is
a single module that owns the layout grammar, with a path builder paired with
`parseArchivePath`, which the packer names its entries through. The larger one
is also the natural home for the `ARCHIVE_MANIFEST_FILE`, `ARCHIVE_SPACE_DIR`
and `ARCHIVE_REVOCATIONS_DIR` constants, which sit in `resourceFileName.ts`
today although they are path grammar and not file names. Refusing a tree is a
behavior change to a shared `@interop/*` API, so the CHANGELOG entry names it.

### SAR-7: Carry Collection tombstones in the archive

- status: in-progress
- priority: medium
- labels: contract, archive-layout, writer, reader, metadata-file
- discovered-from: was-teaching-server WAS-174 (2026-10-03)
- design: was-teaching-server `designs/WAS-96-multi-primary-spaces.md` (section
  5.4 and wire item 16), with decision 0011 in the PWS spec repo
- touches:
  - space-archive (this repo): shipped 2026-10-03, unpublished (0.7.0) -- the
    `collectionTombstone` path area, the manifest's `deleted: true` on a
    tombstone entry, the packer's refusals (including a body that is not a
    strict tombstone and the reserved Collection id `policy`), the reader walk's
    per-Space refusal of a Collection held both ways,
    `collectionTombstoneFromFile` (strict body), `isCollectionTombstone`,
    `collectionMetadataFromFile` refusing a tombstone body; ARCHITECTURE.md
    (archive layout, layer map, Glossary), README and CHANGELOG.md
  - was-teaching-server: unresolved -- both backends export a tombstoned
    Collection in this form and import it (its WAS-174); its ARCHITECTURE.md
  - wallet-backup: unresolved -- its survey still skips the tombstone in the
    Space directory, but `collectionMetadataFromFile` now throws on a
    `deleted: true` body inside a Collection directory (an archive from another
    writer), and its `src/migrate/archiveSurvey.ts` catches that throw after it
    has registered the Collection as a live encrypted app Collection; it needs
    to handle that case when it moves to 0.7.0
  - portable-wallet-profile-spec: unaffected -- the layout is core PWS text
    (PWP-4 moved to portable-web-spaces-spec WASS-7 on 2026-10-29)
  - portable-web-spaces-spec: resolved 2026-10-29 -- the Space Archive Format
    section names the tombstone entry and the manifest `deleted` flag, and the
    Import Space operation states the "only when absent" rule (WASS-7, closing
    the archive box of its WASS-48)
- acceptance:
  - [x] the packer writes a tombstone as `.collection.<collectionId>.json` in
        the Space directory with no Collection directory, and the manifest lists
        it with `deleted: true`; live Collection entries are unchanged
  - [x] the packer refuses a tombstone beside a Collection directory of the same
        id, a tombstone-position body that is not a strict tombstone (no
        `deleted: true`, no whole write stamp, or other members), a
        `deleted: true` body inside a Collection directory, and the Collection
        id `policy`
  - [x] `parseArchivePath` places the tombstone as `collectionTombstone`,
        `collectionTombstoneFromFile` reads it, and the reader's walk refuses a
        Collection held both as a tombstone and as a directory
  - [x] node tests over in-test trees cover the pack, the round trip, and each
        refusal; the checked-in fixtures are unchanged
  - [ ] the reference server exports and imports a tombstoned Collection through
        this form

Context: the PWS reference server is moving Delete Collection from a hard delete
to a stamped tombstone, so a deleted Collection does not come back from a peer
that still holds it. The tombstone has to survive an export and import, or a
restored Space would bring the Collection back the same way. The archive had no
form for it: every Collection travelled as a directory holding its Metadata
file, and a deleted one simply vanished from the archive. The accepted form is
the Collection's `.collection.<id>.json` file, its body the stored tombstone,
with no directory for that Collection and `deleted: true` on its manifest entry.

A live Collection keeps its Metadata file inside its own directory, so a
Collection Metadata file directly in the Space directory can only be a
tombstone. The path grammar and the manifest builder derive the tombstone from
that position, and the body is checked to agree with it. Deriving it from the
position keeps the packer's input shape unchanged (a plain top-level file entry)
and works for a body behind a `read()` thunk, whose bytes are not in hand when
the manifest is built. The manifest flag is descriptive, as the rest of the
manifest's `contents` is, so the reader does not check it against the entries.
The fixtures are left alone: the provenance fixture carries signed statements
only the server can re-sign, and in-test trees cover the form.

### SAR-9: Align the manifest's url values with the PWS spec

- status: todo
- priority: medium
- labels: contract, manifest, writer
- discovered-from: portable-web-spaces-spec WASS review of the Space Archive
  Format section (2026-10-29)
- touches:
  - space-archive (this repo): unresolved -- `UBC_MANIFEST_URL` and
    `RESOURCE_URL` in `src/archive/manifestUrls.ts` and their use in
    `src/archive/exportManifest.ts`; the module comment there, which says the
    URLs were copied from the server and are never rewritten; tests that assert
    the manifest's own entry; this repo's ARCHITECTURE.md (the layout table's
    "UBC v0.1 manifest" line) and CHANGELOG.md
  - was-teaching-server: unresolved -- likely unaffected (it packs through
    `packSpaceArchive` and nothing in its source names the FEP URL), left open
    for confirmation once it picks up the new version; its ARCHITECTURE.md
  - wallet-backup: unresolved -- likely unaffected (reader only; the manifest is
    descriptive and the reader classifies entries by path), left open for
    confirmation
  - portable-web-spaces-spec: resolved 2026-10-29 -- the Space Archive Format
    section's manifest example and root `contents` prose name the spec's own
    Archive manifest section as the `manifest.yml` entry's `url`, list a
    Resource representation as a bare name, and drop `#resource-data-model` from
    the permanent-anchor lists; the FEP is now only an editorial note crediting
    the inspiration
- acceptance:
  - [ ] the packer writes
        `https://w3c-ccg.github.io/portable-web-spaces-spec/#archive-manifest`
        as the `url` of the `manifest.yml` entry, and no FEP URL appears in the
        archive
  - [ ] the packer lists a Resource representation entry as a bare name, with no
        `url`, and `RESOURCE_URL` is removed
  - [ ] `src/archive/manifestUrls.ts` no longer names FEP-6fcd, and its module
        comment states that the PWS spec, not the server, is the source of the
        documenting URLs
  - [ ] a test asserts the manifest's own entry carries the spec URL
  - [ ] ARCHITECTURE.md describes the manifest as the PWS archive manifest
        rather than "the UBC v0.1 manifest"
  - [ ] the CHANGELOG entry names the change as wire text that readers of older
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
Resource Metadata, policy) already point at the PWS spec and are untouched.

This is a wire-text change. An archive written before it carries the FEP URL and
one written after carries the spec URL. The reader does not check the manifest's
`url` values (the manifest is descriptive and entries are classified by path),
so both archives read the same way, but a consumer that compares manifests byte
for byte will see the difference. Older archives are not rewritten.
