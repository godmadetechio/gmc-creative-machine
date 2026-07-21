"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { AssetRequest } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { ASSET_KIND_LABELS } from "./assets/asset-kinds";

// Formats the open requests as a plain-language message ready to paste
// into an email or WhatsApp to the client.
function formatRequestList(clientName: string, requests: AssetRequest[]): string {
  const lines = [
    `Hi! To make the next batch of ${clientName} ads even stronger, could you send over:`,
    "",
  ];
  requests.forEach((request, i) => {
    const priority = request.priority === "high_impact" ? " (biggest impact)" : "";
    lines.push(`${i + 1}. ${ASSET_KIND_LABELS[request.requested_kind]}${priority}`);
    lines.push(`   What we need: ${request.detail}`);
    lines.push(`   Why: ${request.reason}`);
    lines.push("");
  });
  lines.push("Phone photos are perfectly fine — natural beats polished. Thank you!");
  return lines.join("\n");
}

export function CopyRequestsButton({
  clientName,
  requests,
}: {
  clientName: string;
  requests: AssetRequest[];
}) {
  const [copied, setCopied] = useState(false);
  if (requests.length === 0) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(formatRequestList(clientName, requests));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied!" : "Copy request list"}
    </Button>
  );
}
