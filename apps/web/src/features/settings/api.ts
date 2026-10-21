import { api } from '@/lib/api'
import type { UserSettings } from '@/types/api'

export const saveSettings = (body: UserSettings) =>
  api<UserSettings>('/api/settings', { method: 'PUT', body })
