/**
 * Hands `data` to the browser as a JSON file download. The object URL is revoked a minute later, not in the same tick as
 * the click: revoking at once can cancel the download on some mobile browsers, and the file is the owner's only copy of a
 * note when this is used before a device is cleared. (No page can see whether the file landed — callers say "downloaded",
 * never "saved safely".)
 */
export function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
