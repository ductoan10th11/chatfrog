import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { S } from '@/lib/strings'

/** Open the settings modal through the sidebar's user menu. */
export async function openSettings(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: S.nav.userMenu }))
  await user.click(await screen.findByRole('menuitem', { name: S.nav.settings }))
}
