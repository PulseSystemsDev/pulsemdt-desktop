export type PanelId =
  | 'dispatch' | 'map' | 'mdt' | 'ems'
  | 'cases' | 'reports' | 'courts' | 'civilian'
  | 'shifts' | 'roster' | 'codes' | 'analytics' | 'admin';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number;
}

export interface PulseMDTConfig {
  serverUrl: string;
  windowLayouts: Partial<Record<PanelId, WindowBounds>>;
  openPanels: PanelId[];
}

export interface PulseDesktopAPI {
  platform: string;
  version: string;
  isDesktop: true;
  openPanel: (panelId: PanelId) => void;
  closePanel: (panelId: PanelId) => void;
  openMulti: (panelIds: PanelId[]) => void;
  getPanelStatus: () => Promise<Record<PanelId, boolean>>;
  onPanelStatusChange: (cb: (status: Record<PanelId, boolean>) => void) => () => void;
  onUpdateAvailable: (cb: () => void) => () => void;
  onDutyAction: () => void;
}

declare global {
  interface Window {
    pulseDesktop?: PulseDesktopAPI;
    setupAPI?: {
      testConnection: (url: string) => Promise<{ ok: boolean; error?: string }>;
      save: (url: string) => Promise<void>;
    };
  }
}
