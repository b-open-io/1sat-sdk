import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Kbd } from '@/components/ui/kbd'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bot,
  Code,
  Copy,
  ExternalLink,
  RotateCw,
} from 'lucide-react'

interface BrowserContextMenuProps {
  children: React.ReactNode
  onBack: () => void
  onForward: () => void
  onReload: () => void
  canGoBack: boolean
  canGoForward: boolean
  currentUrl: string
  onBookmark?: () => void
}

export function BrowserContextMenu({
  children,
  onBack,
  onForward,
  onReload,
  canGoBack,
  canGoForward,
  currentUrl,
  onBookmark,
}: BrowserContextMenuProps) {
  const isOnchain =
    currentUrl.startsWith('1sat://') &&
    !currentUrl.startsWith('1sat://browser/') &&
    !currentUrl.startsWith('1sat://wallet/') &&
    !currentUrl.startsWith('1sat://settings') &&
    !currentUrl.startsWith('1sat://social/') &&
    !currentUrl.startsWith('1sat://tokens/') &&
    !currentUrl.startsWith('1sat://ordinals/') &&
    !currentUrl.startsWith('1sat://collections/') &&
    !currentUrl.startsWith('1sat://locks/') &&
    !currentUrl.startsWith('1sat://opns/') &&
    !currentUrl.startsWith('1sat://chat') &&
    !currentUrl.startsWith('1sat://identity/') &&
    !currentUrl.startsWith('1sat://publish/') &&
    !currentUrl.startsWith('1sat://apps') &&
    !currentUrl.startsWith('1sat://onboarding/')

  const ordfsUrl = isOnchain
    ? `http://127.0.0.1:8080/content/${currentUrl.replace('1sat://', '')}`
    : null

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Navigation */}
        <ContextMenuItem
          disabled={!canGoBack}
          onClick={onBack}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <ArrowLeft size={14} />
            <span className="text-[11px]">Back</span>
          </span>
          <Kbd>⌘[</Kbd>
        </ContextMenuItem>

        <ContextMenuItem
          disabled={!canGoForward}
          onClick={onForward}
          className="flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <ArrowRight size={14} />
            <span className="text-[11px]">Forward</span>
          </span>
          <Kbd>⌘]</Kbd>
        </ContextMenuItem>

        <ContextMenuItem onClick={onReload} className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <RotateCw size={14} />
            <span className="text-[11px]">Reload</span>
          </span>
          <Kbd>⌘R</Kbd>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Page actions */}
        <ContextMenuItem onClick={onBookmark} className="flex items-center gap-2">
          <Bookmark size={14} />
          <span className="text-[11px]">Bookmark This Page</span>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => {
            navigator.clipboard.writeText(currentUrl)
          }}
          className="flex items-center gap-2"
        >
          <Copy size={14} />
          <span className="text-[11px]">Copy URL</span>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Developer / on-chain */}
        <ContextMenuItem className="flex items-center gap-2">
          <Code size={14} />
          <span className="text-[11px]">View Page Source</span>
        </ContextMenuItem>

        <ContextMenuItem
          disabled={!ordfsUrl}
          onClick={() => {
            if (ordfsUrl) window.open(ordfsUrl, '_blank')
          }}
          className="flex items-center gap-2"
        >
          <ExternalLink size={14} />
          <span className="text-[11px]">View on ORDFS</span>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Agent */}
        <ContextMenuItem className="flex items-center gap-2 text-purple-400 focus:text-purple-400">
          <Bot size={14} className="text-purple-400" />
          <span className="text-[11px]">Ask Agent About This</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
