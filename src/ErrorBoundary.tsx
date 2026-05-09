import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[Epsteiner] uncaught", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0c0c0c", color: "#e8e8e8", fontFamily: "ui-monospace, monospace", padding: 24,
      }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something broke.</h1>
          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
            {this.state.error.message || "Unknown error"}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#d4af37", color: "#000", border: 0, padding: "10px 18px",
              fontFamily: "inherit", fontSize: 13, cursor: "pointer", fontWeight: 700,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
