import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { AuthGuard, GuestGuard } from '@/features/auth/AuthGuard'
import { LoginPage } from '@/features/auth/LoginPage'
import { PendingPage } from '@/features/auth/PendingPage'
import { AppShell } from './AppShell'

export const routes: RouteObject[] = [
  {
    // Shown while the first lazy route chunk loads.
    HydrateFallback: FullScreenLoader,
    children: [
      {
        path: '/login',
        element: <GuestGuard />,
        children: [{ index: true, element: <LoginPage /> }],
      },
      { path: '/pending', element: <PendingPage /> },
      {
        element: <AuthGuard />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                path: '/',
                lazy: async () => ({
                  Component: (await import('@/features/chat/NewChatPage')).NewChatPage,
                }),
              },
              {
                path: '/images',
                lazy: async () => ({
                  Component: (await import('@/features/library/ImagesPage')).ImagesPage,
                }),
              },
              {
                path: '/documents',
                lazy: async () => ({
                  Component: (await import('@/features/library/DocumentsPage')).DocumentsPage,
                }),
              },
              {
                path: '/c/:id',
                lazy: async () => ({
                  Component: (await import('@/features/chat/ChatPage')).ChatPage,
                }),
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
