# Space Archive Roadmap (open items)

nextAvailableId: 5

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

### SAR-1: Reserve the Space id `policy` across the contract's parties

- status: todo
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
The WAS reference server already reserves `policy` for Collection and Resource
ids but not for Space ids, so a Space named `policy` can still be created there
today, even though it can no longer be exported as a per-Space archive. The
portable-wallet-profile-spec's normative layout text does not mention the
reservation at all. `wallet-backup` only reads Space archives back, so it is
likely unaffected, but that is unconfirmed.

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
