import { test, expect } from '@playwright/test'

test('packs and reads an archive in the browser', async ({ page }) => {
  await page.goto('/test/index.html')
  const result = await page.evaluate(async () => {
    // This callback runs in the browser; the '/src/...' specifiers are URLs
    // served by the vite dev server, not module paths tsc can resolve from
    // disk.
    // @ts-expect-error -- dev-server URL, resolved at runtime by vite
    const archive = await import('/src/index.ts')

    const pack = await archive.packSpaceArchive({
      spaceId: 'zBrowserSpace',
      entries: [
        {
          name: '.space.zBrowserSpace.json',
          bytes: new TextEncoder().encode('{"id":"zBrowserSpace"}')
        }
      ]
    })
    const archiveBytes = await archive.collectBytes(pack)

    const space = await archive.readSpaceArchive(archiveBytes)
    const files: Record<string, string> = {}
    for await (const entry of space.entries) {
      files[entry.name] =
        entry.type === 'file'
          ? new TextDecoder().decode(await entry.bytes())
          : ''
    }
    return { spaceId: space.spaceId, files }
  })
  expect(result.spaceId).toBe('zBrowserSpace')
  expect(result.files).toEqual({
    'space/': '',
    'space/zBrowserSpace/': '',
    'space/zBrowserSpace/.space.zBrowserSpace.json': '{"id":"zBrowserSpace"}'
  })
})

test('reads the checked-in fixture archive from a fetched stream', async ({
  page
}) => {
  await page.goto('/test/index.html')
  const result = await page.evaluate(async () => {
    // @ts-expect-error -- dev-server URL, resolved at runtime by vite
    const archive = await import('/src/index.ts')

    const response = await fetch('/fixtures/space-archive.tar')
    const space = await archive.readSpaceArchive(response.body)
    const names: string[] = []
    let representation = ''
    for await (const entry of space.entries) {
      names.push(entry.name)
      if (entry.name.endsWith('/r.note%2E1.application%2Fjson.json')) {
        representation = new TextDecoder().decode(await entry.bytes())
      }
    }
    return { ok: response.ok, spaceId: space.spaceId, names, representation }
  })
  expect(result.ok).toBe(true)
  expect(result.spaceId).toBe('zFixtureSpace')
  expect(result.names).toEqual([
    'space/',
    'space/zFixtureSpace/',
    'space/zFixtureSpace/.space.zFixtureSpace.json',
    'space/zFixtureSpace/notes/',
    'space/zFixtureSpace/notes/.collection.notes.json',
    'space/zFixtureSpace/notes/.collectionlog.notes.json',
    'space/zFixtureSpace/notes/.meta.note.1.json',
    'space/zFixtureSpace/notes/r.note%2E1.application%2Fjson.json',
    'revocations/',
    'revocations/urn%3Auuid%3Afixture-revocation.json'
  ])
  expect(JSON.parse(result.representation)).toEqual({ note: 'hello' })
})
