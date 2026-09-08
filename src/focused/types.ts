export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HomeAssistantState>;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  [key: string]: unknown;
}

export type FocusedPosition = number | string;

export interface FocusedCameraPair {
  title: string;
  main: string;
  hd: string;
}

export interface FocusedOverlayButton {
  enabled: boolean;
  icon: string;
  active_icon: string;
}

export interface FocusedControlGroup {
  x: FocusedPosition;
  y: FocusedPosition;
  spacing: FocusedPosition;
}

export interface FocusedPreset {
  name: string;
  icon: string;
}

export interface FocusedPresetGroup {
  camera: string;
  device_id: string;
  x: FocusedPosition;
  y: FocusedPosition;
  spacing: FocusedPosition;
  presets: FocusedPreset[];
}

export interface FocusedSettings {
  button_size: number;
  controls: FocusedControlGroup;
  substream: FocusedOverlayButton;
  recording: FocusedOverlayButton;
  fullscreen: FocusedOverlayButton;
  preset_groups: FocusedPresetGroup[];
}

export interface FocusedModel {
  cameras: FocusedCameraPair[];
  settings: FocusedSettings;
}

export interface RawFocusedCamera {
  camera_entity?: string;
  id?: string;
  title?: string;
  live_provider?: string;
  dependencies?: {
    cameras?: string[];
  };
  capabilities?: {
    disable_except?: string[];
  };
}

export interface RawFocusedSettings {
  button_size?: number;
  controls?: Partial<FocusedControlGroup>;
  substream?: Partial<FocusedOverlayButton>;
  recording?: Partial<FocusedOverlayButton>;
  fullscreen?: Partial<FocusedOverlayButton>;
  preset_groups?: FocusedPresetGroup[];
}

export interface RawFocusedConfig {
  type?: string;
  cameras?: RawFocusedCamera[];
  focused?: RawFocusedSettings;
  [key: string]: unknown;
}

export interface CameraCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: RawFocusedConfig): void;
}
