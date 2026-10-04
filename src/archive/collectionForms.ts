/**
 * The one rule for a Collection held in two forms at once, shared by the
 * packer (`exportTar.ts`) and the reader (`readSpaceArchive.ts`).
 */
import type { ArchivePath } from './archivePath.js'

/**
 * Tracks, across the entries of one archive, the form each Collection is held
 * in: a Collection tombstone, or a Collection directory with its entries. A
 * tombstone has no member entries, so a Collection seen in both forms is one
 * the layout does not allow. The packer and the reader both run their entries
 * through this, so the two agree on what counts as either form. It keeps the
 * Collections it has seen, by Space id and Collection id, and no entry.
 */
export class CollectionForms {
  private readonly forms = new Map<string, 'tombstone' | 'directory'>()

  /**
   * Records the form one entry shows its Collection in. An entry at a
   * tombstone path that is not a file is not a tombstone, and an entry
   * outside any Collection shows none.
   * @param options {object}
   * @param options.position {ArchivePath}   the entry's parsed path
   * @param options.isFile {boolean}
   * @returns {string | undefined}   the Collection id, when the entry shows a
   *   Collection already seen in the other form
   */
  conflictAt({
    position,
    isFile
  }: {
    position: ArchivePath
    isFile: boolean
  }): string | undefined {
    let form: 'tombstone' | 'directory'
    if (position.area === 'collectionTombstone') {
      if (!isFile) {
        return undefined
      }
      form = 'tombstone'
    } else if (position.area === 'collection' || position.area === 'chunk') {
      form = 'directory'
    } else {
      return undefined
    }
    // Neither id holds a `/`, so the joined key names one Collection.
    const collection = `${position.spaceId}/${position.collectionId}`
    const seen = this.forms.get(collection)
    if (seen === undefined) {
      this.forms.set(collection, form)
      return undefined
    }
    return seen === form ? undefined : position.collectionId
  }
}
