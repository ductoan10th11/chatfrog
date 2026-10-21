import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AuthGuard, GuestGuard } from '@/features/auth/AuthGuard'
import { LoginPage } from '@/features/auth/LoginPage'
import { PendingPage } from '@/features/auth/PendingPage'
import { AdminPage } from '@/features/admin/AdminPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { NewChatPage } from '@/features/chat/NewChatPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AppShell } from './AppShell'

export const routes: RouteObject[] = [
  { path: '/login', element: <GuestGuard />, children: [{ index: true, element: <LoginPage /> }] },
  { path: '/pending', element: <PendingPage /> },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <NewChatPage /> },
          { path: '/c/:id', element: <ChatPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/admin', element: <AdminPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const createRouter = () => createBrowserRouter(routes)
