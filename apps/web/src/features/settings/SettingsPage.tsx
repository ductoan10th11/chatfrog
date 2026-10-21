import { S } from '@/lib/strings'

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h2 className="text-xl font-semibold">{S.settings.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{S.settings.comingSoon}</p>
    </div>
  )
}
