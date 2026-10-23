'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PlaceholderArt } from '@/components/home/placeholder-art'
import type { Item } from '@/types'

function FeaturedImage({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false)
  const cover = item.media[0]
  return cover && !failed ? (
    <Image
      src={cover.url}
      alt={cover.alt ?? item.title}
      fill
      priority
      unoptimized
      sizes="(max-width: 768px) 90vw, 44vw"
      className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
      onError={() => setFailed(true)}
    />
  ) : (
    <PlaceholderArt item={item} />
  )
}

export function AlphaHero({ item }: { item?: Item }) {
  const t = useTranslations('home.hero')
  const tCommon = useTranslations('common')
  return (
    <section className="market-surface relative grid min-h-[430px] overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative z-10 flex flex-col items-start justify-center px-6 py-12 sm:px-10 lg:px-14">
        <p className="market-eyebrow flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          {t('eyebrow')}
        </p>
        <h1 className="market-heading mt-5 max-w-[12ch] text-4xl leading-[1.12] sm:text-5xl lg:text-6xl">
          {t('title')}
        </h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
          {t('body')}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/explore">
              {t('explore')} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/publish">{t('publish')}</Link>
          </Button>
        </div>
      </div>
      {item ? (
        <Link
          href={`/listing/${item.id}`}
          aria-label={
            item.illustrativeImage === true
              ? `${item.title} · ${tCommon('illustration')}`
              : item.title
          }
          className="group relative m-4 min-h-72 overflow-hidden rounded-md bg-muted sm:m-6 lg:m-8"
        >
          <FeaturedImage key={item.id} item={item} />
          {item.illustrativeImage === true && (
            <Badge className="absolute left-3 top-3 z-10 bg-black/75 text-white hover:bg-black/75">
              {tCommon('illustration')}
            </Badge>
          )}
          <span className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-sm bg-card/95 px-4 py-3 text-xs text-card-foreground shadow-sm backdrop-blur-sm sm:inset-x-4 sm:bottom-4">
            <span className="market-eyebrow shrink-0">01 / {t('featured')}</span>
            <strong className="truncate text-right text-sm">{item.title}</strong>
          </span>
        </Link>
      ) : (
        <div
          className="relative m-4 flex min-h-72 items-center justify-center overflow-hidden rounded-md bg-secondary sm:m-6 lg:m-8"
          aria-hidden
        >
          <span className="font-display text-[12rem] font-bold leading-none text-primary/20">
            B
          </span>
          <span className="absolute bottom-6 right-7 text-5xl text-primary/60">✦</span>
        </div>
      )}
    </section>
  )
}
