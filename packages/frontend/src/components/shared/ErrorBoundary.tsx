import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { I18nContext } from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <I18nContext.Consumer>
          {({ t }) => (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
              <h1 className="text-2xl font-bold">{t("common.error_boundary_title")}</h1>
              <p className="text-muted-foreground text-center max-w-md">
                {t("common.error_boundary_body")}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
              >
                {t("common.error_reload")}
              </button>
            </div>
          )}
        </I18nContext.Consumer>
      );
    }

    return this.props.children;
  }
}
