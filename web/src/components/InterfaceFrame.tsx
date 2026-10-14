import type { DragEvent, ReactNode } from "react";
import type { Translator } from "../i18n";
import type { InterfaceId } from "../lib/appearance";
import { interfaceCatalog, interfaceForId } from "../lib/interfaceCatalog";


export interface InterfaceFrameProps {
  interfaceId: InterfaceId;
  immersive?: boolean;
  /**
   * Registered focused composition: the host header owns navigation and the
   * trusted status menu, so the immersive frame must not also render its own
   * separate navigation disclosure. Presentation only.
   */
  focused?: boolean;
  header: ReactNode;
  navigation: ReactNode;
  content: ReactNode;
  details?: ReactNode;
  compact: boolean;
  detailActive: boolean;
  empty: boolean;
  t: Translator;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

/**
 * A presentation-only frame around the existing client surfaces.
 * App owns navigation and all flow state. Presentation children may remount
 * when the selected layout changes; their source state remains in App/hooks.
 */
function WorkspaceFrame({ header, navigation, content, details, compact, detailActive, empty, onDragOver, onDrop }: InterfaceFrameProps) {
  const stateClasses = `${detailActive ? "detail-active" : ""} ${empty ? "empty-library" : ""}`.trim();
  return <div className="interface-frame interface-workspace" data-interface="workspace">
    {header}
    <main className={`workspace ${stateClasses}`} onDragOver={onDragOver} onDrop={onDrop}>
      {!compact && navigation}
      {content}
      {details}
    </main>
  </div>;
}

function ShowcaseFrame({ header, navigation, content, details, compact, detailActive, empty, onDragOver, onDrop }: InterfaceFrameProps) {
  const stateClasses = `${detailActive ? "detail-active" : ""} ${empty ? "empty-library" : ""}`.trim();
  return <div className={`interface-frame interface-showcase ${stateClasses}`} data-interface="showcase">
    {!compact && <div className="showcase-navigation">
      <div className="showcase-mark" aria-hidden="true">RW</div>
      {navigation}
    </div>}
    <div className="showcase-stage">
      <div className="showcase-header">{header}</div>
      <main className={`showcase-workspace ${stateClasses}`} onDragOver={onDragOver} onDrop={onDrop}>
        <div className="showcase-content">{content}</div>
        {details && <div className="showcase-details">{details}</div>}
      </main>
    </div>
  </div>;
}

/** Immersive pages still expose the same host navigation, search and inspector. */
function ImmersiveFrame({ header, navigation, content, details, compact, detailActive, focused, t, onDragOver, onDrop }: InterfaceFrameProps) {
  return <div className="interface-frame interface-immersive" data-chrome="immersive" data-composition={focused ? "focused" : undefined}>
    {header}
    {!focused && !compact && <details className="immersive-navigation">
      <summary>{t("Browse tools")}</summary>
      <div className="immersive-navigation-content">{navigation}</div>
    </details>}
    <main className={`immersive-workspace ${detailActive ? "detail-active" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <div className="immersive-content">{content}</div>
      {details && <div className="immersive-details">{details}</div>}
    </main>
  </div>;
}

const shellRenderers = new Map<string, (props: InterfaceFrameProps) => ReactNode>([
  ["shell.cairn.workspace", WorkspaceFrame],
  ["shell.cairn.showcase", ShowcaseFrame],
]);
for (const definition of interfaceCatalog) {
  if (!shellRenderers.has(definition.renderSlot)) throw new Error(`Missing compiled interface renderer: ${definition.id}`);
}
for (const slot of shellRenderers.keys()) {
  if (!interfaceCatalog.some((definition) => definition.renderSlot === slot)) throw new Error(`Unregistered interface renderer: ${slot}`);
}

export function InterfaceFrame(props: InterfaceFrameProps) {
  const definition = interfaceForId(props.interfaceId);
  if (!definition) throw new Error(`Unknown interface: ${props.interfaceId}`);
  // A focused composition always uses the immersive frame: the host header owns
  // the single navigation/status menu, so a second inline rail (workspace or
  // showcase) must never mount beside it.
  if (props.immersive || props.focused) return <ImmersiveFrame {...props} />;
  const Frame = shellRenderers.get(definition.renderSlot)!;
  return <Frame {...props} />;
}
