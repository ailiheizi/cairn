/** Trusted, compiled shells. This catalog is a contribution seam, not a runtime ABI. */
export type InterfaceDefinition = {
  id: string;
  renderSlot: string;
  label: string;
  description: string;
  preview: "workspace" | "showcase";
};

export function validateInterfaces(definitions: readonly InterfaceDefinition[]): void {
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const item of definitions) {
    if (item.id !== "workspace" && item.id !== "showcase" && !/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/.test(item.id)) throw new Error(`Invalid interface ID: ${item.id}`);
    if (item.id.startsWith("host:") || item.renderSlot.startsWith("host.")) throw new Error(`Interface collides with a reserved host contribution: ${item.id}`);
    if (ids.has(item.id)) throw new Error(`Duplicate interface ID: ${item.id}`);
    if (!item.renderSlot.trim() || slots.has(item.renderSlot)) throw new Error(`Duplicate or empty interface renderer slot: ${item.renderSlot}`);
    if (!item.label.trim() || !item.description.trim()) throw new Error(`Missing interface label or description: ${item.id}`);
    ids.add(item.id);
    slots.add(item.renderSlot);
  }
  if (!ids.has("workspace")) throw new Error("The host workspace fallback must be registered");
}

export const interfaceCatalog: readonly InterfaceDefinition[] = [
  { id: "workspace", renderSlot: "shell.restoreweave.workspace", label: "Workspace interface", description: "Keep search, results, and details together for focused work.", preview: "workspace" },
  { id: "showcase", renderSlot: "shell.restoreweave.showcase", label: "Content showcase", description: "Give saved content more room with a visual, browse-first layout.", preview: "showcase" },
];
validateInterfaces(interfaceCatalog);

export function interfaceForId(id: unknown): InterfaceDefinition | undefined {
  return typeof id === "string" ? interfaceCatalog.find((item) => item.id === id) : undefined;
}

export function normalizeInterfaceId(id: unknown): string {
  return interfaceForId(id)?.id ?? "workspace";
}
