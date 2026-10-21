import { Link, useParams } from 'react-router'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError, errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import { useConversation } from '@/features/conversations/queries'
import { flattenMessages, useMessages } from './queries'

export function ChatPage() {
  const { id = '' } = useParams()
  const conversation = useConversation(id)
  const messages = useMessages(id)

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
  if (messages.isPending) return <Skeleton className="m-4 h-24" />

  return (
    <div className="mx-auto h-full max-w-3xl space-y-4 overflow-y-auto p-4">
      {flattenMessages(messages.data?.pages).map((m) => (
        <div
          key={m.id}
          className={m.role === 'user' ? 'ml-auto w-fit rounded-2xl bg-surface px-4 py-2' : ''}
        >
          {m.parts.map((p, i) => (p.type === 'text' ? <p key={i}>{p.text}</p> : null))}
        </div>
      ))}
    </div>
  )
}
