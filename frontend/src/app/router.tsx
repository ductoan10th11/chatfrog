import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { AdminPage } from '@/features/admin/AdminPage'
import { AuthGuard, GuestGuard } from '@/features/auth/AuthGuard'
import { LoginPage } from '@/features/auth/LoginPage'
import { PendingPage } from '@/features/auth/PendingPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
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
                path: '/c/:id',
                lazy: async () => ({
                  Component: (await import('@/features/chat/ChatPage')).ChatPage,
                }),
              },
              { path: '/settings', element: <SettingsPage /> },
              { path: '/admin', element: <AdminPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
