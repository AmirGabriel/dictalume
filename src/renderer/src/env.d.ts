/// <reference types="vite/client" />

import type { DesktopAPI } from '../../shared/types'

declare global {
  interface Window {
    desktop: DesktopAPI
  }
}

export {}
