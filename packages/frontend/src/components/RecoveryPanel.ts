import type { PolicyDoc } from "@nidohq/passkey-sdk";

    export interface RecoveryPanelContext {
  account: string;
  networkPassphrase: string;
  getBaseline: () => {
    doc: PolicyDoc | null;
    blocked: string | null;
    loaded: boolean;
    isFirstApply: boolean;
  };
  applyUpdate: (args: {
    wrap: HTMLElement;
    submitSel: string;
    statusSel: string;
    showErrors: (errors: string[]) => void;
    buildDoc: () => PolicyDoc;
    successToast: string;
    rerender: () => void;
  }) => Promise<void>;
  showErrorsIn: (wrap: HTMLElement, sel: string, errors: string[]) => void;
}

export function mountRecoveryPanel(wrap: HTMLElement, ctx: RecoveryPanelContext): {
  render: () => void;
  updatePreview: () => void;
} {
  // render/collectDraft/updatePreview/submit go here, next step
  return { render: () => {}, updatePreview: () => {} };
}