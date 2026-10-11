// Copy-prompt clipboard (D-54): the prompt holds a slice of the owner's notes, so it is cleared after a short timeout while
// the app is open — best effort, and only if the clipboard still holds exactly what was copied (anything the owner copied
// since is left alone). Android clipboard managers and keyboards can keep their own history; no page can reach that.
export const CLEAR_AFTER_MS = 120_000

let timer: number | undefined

export async function copyPrompt(text: string, clearAfterMs = CLEAR_AFTER_MS): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return false
  }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void clearIfStill(text), clearAfterMs)
  return true
}

async function clearIfStill(text: string): Promise<void> {
  try {
    // Only when reading is already allowed: asking for permission two minutes after the copy, out of context, would be worse.
    const p = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
    if (p.state !== 'granted') return
    if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('')
  } catch {
    // no permission API, no focus or no permission: nothing is cleared (best effort, said so in the UI)
  }
}
