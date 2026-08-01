'use client'

import { useEffect } from 'react'
import { useTheme } from './theme-provider'

const LIGHT_ICON = '/icon.svg'
const DARK_ICON = '/icon-dark.svg'

/**
 * Updates the document's favicon <link> element to match the current theme.
 * Renders nothing — this is a side-effect-only component. Mounted once at the
 * root of the locale layout, after the ThemeProvider.
 */
export function ThemeFaviconSync() {
  const { theme } = useTheme()

  useEffect(() => {
    const target = theme === 'dark' ? DARK_ICON : LIGHT_ICON
    // Update every <link rel="icon"> that has a media attribute OR no type
    // attribute (the default Next.js icon link). We leave the apple-touch
    // icon link alone — iOS Safari does not re-evaluate it on theme change.
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    links.forEach(link => {
      if (link.getAttribute('type') === 'image/svg+xml') {
        link.href = target
      }
    })
  }, [theme])

  return null
}