import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentTypeSelectProps {
  /** Currently selected content type */
  value: string
  /** Callback when content type changes */
  onValueChange: (value: string) => void
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_TYPE_OPTIONS = [
  { value: "image/png", label: "PNG Image" },
  { value: "image/jpeg", label: "JPEG Image" },
  { value: "image/gif", label: "GIF Image" },
  { value: "image/svg+xml", label: "SVG Image" },
  { value: "image/webp", label: "WebP Image" },
  { value: "text/plain", label: "Plain Text" },
  { value: "text/html", label: "HTML" },
  { value: "text/markdown", label: "Markdown" },
  { value: "application/json", label: "JSON" },
  { value: "video/mp4", label: "MP4 Video" },
  { value: "audio/mpeg", label: "MP3 Audio" },
  { value: "application/octet-stream", label: "Binary / Other" },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dropdown for selecting or overriding the MIME content type of a file
 * to be inscribed. Auto-detects from the uploaded file but allows manual
 * override for edge cases (e.g. SVG uploaded as application/xml).
 */
export function ContentTypeSelect({
  value,
  onValueChange,
  className,
}: ContentTypeSelectProps) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor="content-type-select">Content Type</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="content-type-select">
          <SelectValue placeholder="Select content type" />
        </SelectTrigger>
        <SelectContent>
          {CONTENT_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">
                  {option.value}
                </span>
                <span className="sr-only">{option.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Auto-detected from file. Override if needed.
      </p>
    </div>
  )
}
