import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useChatStore } from '@/features/chat/store'
import { fetchMe, logout } from './api'

export const ME_KEY = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    try {
      await logout()
    } finally {
      useChatStore.getState().abortAll()
      qc.clear()
      qc.setQueryData(ME_KEY, null)
      navigate('/login', { replace: true })
    }
  }
}
