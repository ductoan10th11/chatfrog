import { create } from 'zustand'

type SettingsModalState = {
  open: boolean
  setOpen: (open: boolean) => void
}

/** Lets the sidebar's user menu open the modal that AppShell renders once. */
export const useSettingsModal = create<SettingsModalState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
