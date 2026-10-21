import { useCallback, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useConversation } from '@/features/conversations/queries'
import { errorMessage, isApiError } from '@/lib/api'
import { S } from '@/lib/strings'
import type { Message } from '@/types/api'
import { Composer } from './components/Composer'
import { MessageList } from './components/MessageList'
import { buildDisplayItems, regenerableId } from './display'
import { flattenMessages, useMessages } from './queries'
import { useLiveGeneration } from './store'
import { useGenerate } from './useGenerate'

/** `/c/:id`. Keyed by id so per-conversation UI state (editing, scroll) resets on navigation. */
export function ChatPage() {
  const { id = '' } = useParams()
  return <ChatView key={id} id={id} />
}

function ChatView({ id }: { id: string }) {
  const conversation = useConversation(id)
  const messages = useMessages(id)
  const live = useLiveGeneration(id)
  const generate = useGenerate()

  const title = conversation.data?.title
  useEffect(() => {
    document.title = title ? `${title} · ${S.app.name}` : S.app.name
    return () => {
      document.title = S.app.name
    }
  }, [title])

  const persisted = useMemo(() => flattenMessages(messages.data?.pages), [messages.data])
  const items = useMemo(() => buildDisplayItems(persisted, live), [persisted, live])
  const regenId = live ? null : regenerableId(items)

  const { regenerate, edit } = generate
  const onRegenerate = useCallback((m: Message) => void regenerate(id, m), [regenerate, id])
  const onEdit = useCallback(
    (m: Message, content: string, attachmentIds: string[]) =>
      void edit(id, m, content, attachmentIds),
    [edit, id],
  )

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages
  const loadOlder = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (conversation.isError) {
    const notFound = isApiError(conversation.error) && conversation.error.status === 404
    return (
      <ErrorState
        message={notFound ? S.conversation.notFound : errorMessage(conversation.error)}
        onRetry={notFound ? undefined : () => conversation.refetch()}
      >
        {notFound && (
          <Button asChild variant="outline">
            <Link to="/">{S.conversation.goHome}</Link>
          </Button>
        )}
      </ErrorState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {messages.isError ? (
          <ErrorState message={errorMessage(messages.error)} onRetry={() => messages.refetch()} />
        ) : messages.isPending ? (
          <div
            className="mx-auto max-w-3xl space-y-4 p-4"
            aria-busy="true"
            aria-label={S.app.loading}
          >
            <Skeleton className="ml-auto h-10 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {S.chat.emptyConversation}
          </p>
        ) : (
          <MessageList
            items={items}
            queuePosition={live?.queuePosition ?? null}
            regenerableId={regenId}
            busy={!!live}
            hasOlder={!!hasNextPage}
            loadingOlder={isFetchingNextPage}
            onLoadOlder={loadOlder}
            onRegenerate={onRegenerate}
            onEdit={onEdit}
          />
        )}
      </div>
      <Composer
        busy={!!live}
        focusKey={id}
        conversationId={id}
        onSend={(text, attachments) => generate.send(id, text, attachments)}
        onStop={() => generate.stop(id)}
      />
    </div>
  )
}
