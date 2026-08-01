// 模拟聊天 drawer（无后端，本地状态）
'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Send } from 'lucide-react'
import type { Seller } from '@/types'

interface ChatDrawerProps {
  seller: Seller | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ChatMessage {
  id: string
  from: 'me' | 'seller'
  text: string
  at: string
}

export function ChatDrawer({ seller, open, onOpenChange }: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // 打开时初始化欢迎消息
  useEffect(() => {
    if (open && seller && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          from: 'seller',
          text: `你好！我是 ${seller.displayName}，商品有任何问题可以问我 😊`,
          at: new Date().toISOString()
        }
      ])
    }
  }, [open, seller, messages.length])

  // 滚动到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (!seller) return null

  const send = () => {
    const text = input.trim()
    if (!text) return

    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      from: 'me',
      text,
      at: new Date().toISOString()
    }
    setMessages([...messages, newMsg])
    setInput('')

    // 模拟卖家自动回复
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: `reply_${Date.now()}`,
          from: 'seller',
          text: '收到！我看一下，稍后回复你。',
          at: new Date().toISOString()
        }
      ])
    }, 1200)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>联系卖家</SheetTitle>
          <SheetDescription>
            这是模拟聊天，本地状态不会发送到服务器
          </SheetDescription>
        </SheetHeader>

        {/* 卖家信息条 */}
        <div className="flex items-center gap-3 border-b py-3">
          <Avatar className="h-10 w-10">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seller.avatarSeed}`}
              alt={seller.displayName}
            />
            <AvatarFallback>
              {seller.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">{seller.displayName}</div>
            <div className="text-xs text-muted-foreground">在线</div>
          </div>
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-4">
          {messages.map(m => (
            <div
              key={m.id}
              className={`flex gap-2 ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}
            >
              {m.from === 'seller' && (
                <Avatar className="h-7 w-7">
                  <AvatarImage
                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seller.avatarSeed}`}
                  />
                  <AvatarFallback>
                    {seller.displayName.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  m.from === 'me'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        {/* 输入框 */}
        <div className="flex gap-2 border-t pt-3">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            className="flex-1"
          />
          <Button size="icon" onClick={send} disabled={!input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}