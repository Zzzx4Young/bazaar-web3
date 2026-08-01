// 媒体轮播（embla-carousel-react）
'use client'

import useEmblaCarousel from 'embla-carousel-react'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MediaItem } from '@/types'

interface MediaCarouselProps {
  media: MediaItem[]
  alt: string
}

export function MediaCarousel({ media, alt }: MediaCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: 'start' })
  const [selectedIndex, setSelectedIndex] = useState(0)

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    onSelect()
    emblaApi.on('select', onSelect)
    return () => {
      emblaApi.off('select', onSelect)
    }
  }, [emblaApi, onSelect])

  if (media.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
        暂无图片
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border bg-muted">
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {media.map((m, i) => (
              <div key={i} className="relative aspect-square w-full flex-[0_0_100%]">
                <Image
                  src={m.url}
                  alt={m.alt ?? `${alt} - ${i + 1}`}
                  fill
                  sizes="(max-width: 768px) 100vw, 60vw"
                  className="object-cover"
                  unoptimized
                  priority={i === 0}
                />
              </div>
            ))}
          </div>
        </div>
        {media.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/30 text-white hover:bg-black/50"
              onClick={() => emblaApi?.scrollPrev()}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/30 text-white hover:bg-black/50"
              onClick={() => emblaApi?.scrollNext()}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>
      {media.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {media.map((m, i) => (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              className={`relative aspect-square h-16 w-16 flex-shrink-0 overflow-hidden rounded border-2 transition ${
                i === selectedIndex ? 'border-primary' : 'border-transparent opacity-60'
              }`}
            >
              <Image src={m.url} alt={m.alt ?? `thumb ${i + 1}`} fill sizes="64px" className="object-cover" unoptimized />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}