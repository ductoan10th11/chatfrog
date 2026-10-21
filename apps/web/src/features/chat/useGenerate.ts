import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { FileRef, Message } from '@/types/api'
import { startGeneration, stopGeneration, type GenerationResult } from './generation'

/** Actions that start / stop generations. They keep running if the component unmounts. */
export function useGenerate() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMemo(() => {
    const deps = {
      queryClient,
      onConversationCreated: (c: { id: string }) => navigate(`/c/${c.id}`),
    }
    return {
      send: (
        conversationId: string,
        content: string,
        attachments?: FileRef[],
      ): Promise<GenerationResult> =>
        startGeneration({ kind: 'send', conversationId, content, attachments }, deps),
      regenerate: (conversationId: string, message: Message) =>
        startGeneration({ kind: 'regenerate', conversationId, message }, deps),
      edit: (conversationId: string, message: Message, content: string, attachmentIds: string[]) =>
        startGeneration({ kind: 'edit', conversationId, message, content, attachmentIds }, deps),
      stop: stopGeneration,
    }
  }, [queryClient, navigate])
}
