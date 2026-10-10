import { Component } from "react";
import type { ErrorInfo } from "react";
import { InterfaceFrame } from "./InterfaceFrame";
import type { InterfaceFrameProps } from "./InterfaceFrame";

interface Props extends InterfaceFrameProps {
  onFallbackToWorkspace: () => void;
  onOpenSettings: (trigger?: EventTarget | null) => void;
}

interface State {
  interfaceId: InterfaceFrameProps["interfaceId"];
  failed: boolean;
  fallbackNotice: boolean;
  fallbackAttempted: boolean;
}

/** Catches presentation failures without unmounting App or its shared flows. */
export class InterfaceRenderBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { interfaceId: props.interfaceId, failed: false, fallbackNotice: false, fallbackAttempted: false };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.interfaceId === state.interfaceId) return null;
    const automaticWorkspaceFallback = state.interfaceId !== "workspace"
      && props.interfaceId === "workspace"
      && state.fallbackNotice;
    return automaticWorkspaceFallback
      ? { interfaceId: props.interfaceId, failed: false }
      : { interfaceId: props.interfaceId, failed: false, fallbackNotice: false, fallbackAttempted: false };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    if (this.props.interfaceId !== "workspace" && !this.state.fallbackAttempted) {
      // Try the built-in workspace once. If a shared child fails there too,
      // the next caught error remains in the recovery panel.
      this.props.onFallbackToWorkspace();
      this.setState({ failed: false, fallbackNotice: true, fallbackAttempted: true });
    }
  }

  private retry = () => {
    this.setState({ failed: false, fallbackAttempted: false, fallbackNotice: false });
  };

  private dismissFallbackNotice = () => this.setState({ fallbackNotice: false });

  render() {
    const { failed, fallbackNotice } = this.state;
    if (failed) {
      return <section className="interface-recovery" role="alert" aria-live="assertive">
        <h1>{this.props.t("Interface unavailable")}</h1>
        <p>{this.props.t("The workspace interface could not be displayed. Your search, selection, and Notes draft are still held by the app.")}</p>
        {fallbackNotice && <p className="interface-recovery-notice" role="status">{this.props.t("The selected interface failed. RestoreWeave switched to the workspace interface; review your settings before trying another layout.")}</p>}
        <div className="interface-recovery-actions">
          <button type="button" onClick={this.retry}>{this.props.t("Retry selected interface")}</button>
          <button type="button" className="interface-recovery-secondary" onClick={(event) => this.props.onOpenSettings(event.currentTarget)}>{this.props.t("Open settings")}</button>
        </div>
      </section>;
    }

    return <>
      {fallbackNotice && <div className="interface-recovery-notice" role="status">
        <span>{this.props.t("The selected interface failed. RestoreWeave switched to the workspace interface; review your settings before trying another layout.")}</span>
        <button type="button" className="interface-recovery-dismiss" onClick={this.dismissFallbackNotice}>{this.props.t("Dismiss")}</button>
      </div>}
      <InterfaceFrame {...this.props} />
    </>;
  }
}
