// Screenshot and screen-recording block for exam sessions (Android, via Capacitor).
//
// It talks to the native "PrivacyScreen" plugin by name, so it needs no import and
// the web build never breaks. On the web, or if the plugin is not installed, every
// call quietly does nothing.
//
// To switch it on for real:
//   npm i @capacitor-community/privacy-screen
//   npx cap sync android
// then test on a real phone: screenshots must be black during an exam and work
// again on the result screen.

type PrivacyScreenPlugin = { enable: () => Promise<unknown>; disable: () => Promise<unknown> }

let plugin: PrivacyScreenPlugin | null | undefined

function getPlugin(): PrivacyScreenPlugin | null {
  if (plugin !== undefined) return plugin
  try {
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; registerPlugin?: (name: string) => PrivacyScreenPlugin }
    }).Capacitor
    if (cap?.isNativePlatform?.() && cap.registerPlugin) {
      plugin = cap.registerPlugin('PrivacyScreen')
    } else {
      plugin = null
    }
  } catch {
    plugin = null
  }
  return plugin
}

export async function enableScreenProtection(): Promise<void> {
  try { await getPlugin()?.enable() } catch { /* not available: ignore */ }
}

export async function disableScreenProtection(): Promise<void> {
  try { await getPlugin()?.disable() } catch { /* not available: ignore */ }
}
