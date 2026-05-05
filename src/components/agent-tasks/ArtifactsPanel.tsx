"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArtifactCard } from "./ArtifactCard";
import { EmptyState } from "@/components/ui/loading";
import type { Artifact, ArtifactType } from "@/lib/types/task";

export interface ArtifactsPanelProps {
  artifacts: Artifact[];
  onView?: (artifact: Artifact) => void;
  onDownload?: (artifact: Artifact) => void;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  disabled?: boolean;
}

export function ArtifactsPanel({
  artifacts,
  onView,
  onDownload,
  onRefresh,
  refreshing = false,
  disabled = false,
}: ArtifactsPanelProps) {
  const t = useTranslations("agent_tasks.artifacts");
  const tCommon = useTranslations("common");
  const [filterType, setFilterType] = React.useState<ArtifactType | "all">(
    "all",
  );

  const filteredArtifacts = React.useMemo(() => {
    if (filterType === "all") return artifacts;
    return artifacts.filter((a) => a.type === filterType);
  }, [artifacts, filterType]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-transparent">
      <div className="border-b border-subtle px-2.5 py-1.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h2>
          <div className="flex items-center gap-1.5">
            {onRefresh ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-tertiary hover:text-primary"
                onClick={() => void onRefresh()}
                disabled={refreshing || disabled}
                data-testid="agent-tasks__artifacts-refresh"
                title={tCommon("refresh")}
                aria-label={tCommon("refresh")}
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : null}
            <span className="rounded-full bg-surface-high/40 px-1.5 py-0.5 text-[10px] text-tertiary">
              {artifacts.length}
            </span>
          </div>
        </div>
        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v as ArtifactType | "all")}
        >
          <SelectTrigger className="h-7 w-full border-subtle bg-surface-high/18 text-[11px]">
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
