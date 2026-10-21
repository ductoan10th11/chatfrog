import { useEffect } from 'react'
import { Orb } from '@/components/Orb'
import { Button } from '@/components/ui/button'
import { S } from '@/lib/strings'
import { Composer } from './components/Composer'
import { NEW_CONVERSATION } from './generation'
import { useLiveGeneration } from './store'
import { useGenerate } from './useGenerate'

/**
 * `/`: welcome screen. Sending posts to `/api/conversations/new/messages`, then the router
 * moves to `/c/:id` as soon as the server reports the new conversation; the stream keeps going.
 */
export function NewChatPage() {
  const live = useLiveGeneration(NEW_CONVERSATION)
  const generate = useGenerate()
  const busy = !!live

  // Warm up the conversation view so the move to /c/:id is instant once the stream starts.
  useEffect(() => {
    void import('./ChatPage')
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-8 text-center">
        <Orb state="weaving" size={64} displaySize={112} />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{S.welcome.title}</h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{S.welcome.subtitle}</p>
        </div>
        <ul
          aria-label={S.welcome.suggestionsLabel}
          className="flex max-w-xl flex-wrap justify-center gap-2"
        >
          {S.welcome.suggestions.map((s) => (
            <li key={s.label}>
              <Button
                variant="outline"
                size="lg"
                className="h-9 rounded-full bg-surface px-4"
                disabled={busy}
                onClick={() => void generate.send(NEW_CONVERSATION, s.prompt)}
              >
                {s.label}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <Composer
        busy={busy}
        onSend={(text, attachments) => generate.send(NEW_CONVERSATION, text, attachments)}
        onStop={() => generate.stop(NEW_CONVERSATION)}
      />
    </div>
  )
}
