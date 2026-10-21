import { S } from '@/lib/strings'

export function NewChatPage() {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <h2 className="text-2xl font-semibold tracking-tight">{S.welcome.title}</h2>
    </div>
  )
}
