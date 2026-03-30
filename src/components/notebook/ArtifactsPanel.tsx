"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArtifactCard } from "./ArtifactCard";
import { EmptyState } from "@/components/ui/loading";
import type { Artifact, ArtifactType } from "@/lib/types/task";

export interface ArtifactsPanelProps {
  artifacts: Artifact[];
  onView?: (artifact: Artifact) => void;
  onDownload?: (artifact: Artifact) => void;
  disabled?: boolean;
}

export function ArtifactsPanel({
  artifacts,
  onView,
  onDownload,
  disabled = false,
}: ArtifactsPanelProps) {
  const t = useTranslations("notebook.artifacts");
  const [filterType, setFilterType] = React.useState<ArtifactType | "all">(
    "all",
  );

  const filteredArtifacts = React.useMemo(() => {
    if (filterType === "all") return artifacts;
    return artifacts.filter((a) => a.type === filterType);
  }, [artifacts, filterType]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-transparent">
      <div className="border-b border-white/6 px-2.5 py-1.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h2>
          <span className="rounded-full bg-surface-high/40 px-1.5 py-0.5 text-[10px] text-tertiary">
            {artifacts.length}
          </span>
        </div>
        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v as ArtifactType | "all")}
        >
          <SelectTrigger className="h-7 w-full border-white/8 bg-surface-high/18 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.all")}</SelectItem>
            <SelectItem value="text">{t("filter.text")}</SelectItem>
            <SelectItem value="image">{t("filter.image")}</SelectItem>
            <SelectItem value="file">{t("filter.file")}</SelectItem>
            <SelectItem value="other">{t("filter.other")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filteredArtifacts.length === 0 ? (
          <EmptyState title={t("empty")} description={t("empty_description")} />
        ) : (
          <div className="space-y-1.5">
            {filteredArtifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onView={onView ? () => onView(artifact) : undefined}
                onDownload={onDownload ? () => onDownload(artifact) : undefined}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
