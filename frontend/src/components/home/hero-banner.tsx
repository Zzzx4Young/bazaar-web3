// 首页轮播 banner
'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Banner } from '@/types'

interface HeroBannerProps {
  banners: Banner[]
}

export function HeroBanner({ banners }: HeroBannerProps) {
  const active = banners.filter(b => b.active)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (active.length <= 1) return
    const t = setInterval(() => {
      setIndex(i => (i + 1) % active.length)
    }, 5000)
    return () => clearInterval(t)
  }, [active.length])

  if (active.length === 0) return null
  const current = active[index]!

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-[3/1] w-full">
        <Image
          src={current.image}
          alt={current.title}
          fill
          sizes="(max-width: 768px) 100vw, 1200px"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <h2 className="text-xl font-bold sm:text-2xl">{current.title}</h2>
          <p className="mt-1 text-sm text-white/90">{current.subtitle}</p>
        </div>
      </div>
      {active.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/30 text-white hover:bg-black/50"
            onClick={() => setIndex(i => (i - 1 + active.length) % active.length)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/30 text-white hover:bg-black/50"
            onClick={() => setIndex(i => (i + 1) % active.length)}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {active.map((_, i) => (
              <button
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/50'
                }`}
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}