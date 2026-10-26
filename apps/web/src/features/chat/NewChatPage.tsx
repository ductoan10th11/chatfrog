import { useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Logo } from '@/components/Logo'
import { useMe } from '@/features/auth/useMe'
import { S } from '@/lib/strings'
import { Composer } from './components/Composer'
import { NEW_CONVERSATION } from './generation'
import { useLiveGeneration } from './store'
import { useGenerate } from './useGenerate'

/**
 * `/`: welcome screen. Sending posts to `/api/conversations/new/messages`, then the router
 * moves to `/c/:id` as soon as the server reports the new conversation; the stream keeps going.
 * The composer sits mid-screen until a message is sent, then drops to the bottom like in a chat.
 */
export function NewChatPage() {
  const live = useLiveGeneration(NEW_CONVERSATION)
  const generate = useGenerate()
  // Vietnamese given name comes last: "Hoàng Đức Toàn" -> "Toàn".
  const name = useMe().data?.name.trim().split(/\s+/).pop()
  const reduced = useReducedMotion()
  const busy = !!live

  // Warm up the conversation view so the move to /c/:id is instant once the stream starts.
  useEffect(() => {
    void import('./ChatPage')
  }, [])

  return (
    <div className={`flex h-full flex-col ${busy ? 'justify-end' : 'justify-center'}`}>
      {!busy && (
        <div className="space-y-2 px-4 pb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {S.welcome.greeting(name ?? 'bạn')}{' '}
            <Logo className="inline-block size-8 align-[-0.2em]" />
          </h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{S.welcome.subtitle}</p>
        </div>
      )}
      <motion.div layout={!reduced} transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}>
        <Composer
          busy={busy}
          hideDisclaimer={!busy}
          onSend={(text, attachments) => generate.send(NEW_CONVERSATION, text, attachments)}
          onStop={() => generate.stop(NEW_CONVERSATION)}
        />
      </motion.div>
    </div>
  )
}
