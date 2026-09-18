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
    const paths: string[] = []
    for await (const entry of space.entries) {
      paths.push(entry.name)
    }
    return { spaceId: space.spaceId, paths }
  })
  expect(result.spaceId).toBe('zBrowserSpace')
  expect(result.paths).toContain(
    'space/zBrowserSpace/.space.zBrowserSpace.json'
  )
})
