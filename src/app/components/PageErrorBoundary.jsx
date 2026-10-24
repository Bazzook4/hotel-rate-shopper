"use client";

import { Component } from "react";
import CrashNotice from "./CrashNotice";

/**
 * Keeps a crash inside the open page, so the menu and header still work
 * and the desk can move to another page. Key it by page so opening another
 * page clears the error.
 */
export default class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <CrashNotice error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
