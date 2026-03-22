"use client"

import { useCallback } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ContentTypeSelect } from "./content-type-select"

export interface MetadataEntry {
  /** Unique identifier for the entry */
  id: string
  /** MAP key (alphanumeric only) */
  key: string
  /** MAP value */
  value: string
}

export interface InscribeFormProps {
  /** Current metadata entries */
  metadata: MetadataEntry[]
  /** Callback when metadata changes */
  onMetadataChange: (metadata: MetadataEntry[]) => void
  /** The selected file name, used for auto-populating "name" key */
  fileName?: string
  /** Current content type (MIME) */
  contentType: string
  /** Callback when content type changes */
  onContentTypeChange: (contentType: string) => void
  /** Whether BAP sigma signing is enabled */
  signWithBAP: boolean
  /** Callback when BAP signing toggle changes */
  onSignWithBAPChange: (enabled: boolean) => void
  /** Optional CSS class name */
  className?: string
}

function generateId(): string {
  return `meta-${Math.random().toString(36).slice(2, 9)}-${Date.now()}`
}

export function InscribeForm({
  metadata,
  onMetadataChange,
  fileName,
  contentType,
  onContentTypeChange,
  signWithBAP,
  onSignWithBAPChange,
  className,
}: InscribeFormProps) {
  const handleAdd = useCallback(() => {
    const newEntries = [...metadata]

    // Auto-suggest "name" key with file name if not already present
    if (
      newEntries.length === 0 &&
      fileName &&
      !newEntries.some((m) => m.key === "name")
    ) {
      newEntries.push({
        id: generateId(),
        key: "name",
        value: fileName,
      })
    }

    // Always add an empty row for the user
    newEntries.push({
      id: generateId(),
      key: "",
      value: "",
    })

    onMetadataChange(newEntries)
  }, [metadata, onMetadataChange, fileName])

  const handleUpdate = useCallback(
    (id: string, field: "key" | "value", newValue: string) => {
      onMetadataChange(
        metadata.map((entry) => {
          if (entry.id !== id) return entry
          return {
            ...entry,
            [field]:
              field === "key"
                ? newValue.replace(/[^a-zA-Z0-9]/g, "")
                : newValue,
          }
        })
      )
    },
    [metadata, onMetadataChange]
  )

  const handleRemove = useCallback(
    (id: string) => {
      onMetadataChange(metadata.filter((entry) => entry.id !== id))
    },
    [metadata, onMetadataChange]
  )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Content type override */}
      <ContentTypeSelect
        value={contentType}
        onValueChange={onContentTypeChange}
      />

      {/* BAP signing checkbox */}
      <Card>
        <CardContent className="flex items-center gap-3 px-4 py-3">
          <Checkbox
            id="bap-signing"
            checked={signWithBAP}
            onCheckedChange={(checked) => {
              if (typeof checked === "boolean") {
                onSignWithBAPChange(checked)
              }
            }}
          />
          <div className="grid gap-0.5 leading-none">
            <Label htmlFor="bap-signing" className="cursor-pointer text-sm">
              Sign with BAP identity (Sigma)
            </Label>
            <p className="text-xs text-muted-foreground">
              Attach a cryptographic identity proof to this inscription.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Metadata editor */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Metadata (MAP Protocol)</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAdd}
            className="h-8 gap-1"
          >
            <Plus data-icon="inline-start" />
            Add Field
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {metadata.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                placeholder="Key"
                value={entry.key}
                onChange={(e) => handleUpdate(entry.id, "key", e.target.value)}
                className="flex-1"
                aria-label="Metadata key"
              />
              <Input
                placeholder="Value"
                value={entry.value}
                onChange={(e) =>
                  handleUpdate(entry.id, "value", e.target.value)
                }
                className="flex-1"
                aria-label="Metadata value"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => handleRemove(entry.id)}
                className="size-10 flex-shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove metadata field"
              >
                <X data-icon="inline-start" />
              </Button>
            </div>
          ))}

          {metadata.length === 0 && (
            <div className="rounded-md border border-dashed py-4 text-center text-sm text-muted-foreground">
              No metadata added. Click &quot;Add Field&quot; to attach key/value
              pairs.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
