import { createNavigation } from 'next-intl/navigation'
import { defineRouting } from 'next-intl/routing'
import { locales } from './locales'

export const routing = defineRouting({
  locales,
  defaultLocale: 'zh-CN',
  localePrefix: 'always'
})

// Provide a stable Link helper for non-locale-aware code paths
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
