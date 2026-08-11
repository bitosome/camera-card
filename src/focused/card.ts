import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import screenfull from 'screenfull';
import { createDefaultModel, normalizeFocusedConfig } from './config.js';
import type {
  FocusedCameraPair,
  CameraCardEditor,
  FocusedOverlayButton,
  FocusedPresetGroup,
  HomeAssistant,
  RawFocusedConfig,
} from './types.js';

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): Promise<HTMLElement>;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
    customCards?: Array<Record<string, unknown>>;
  }
}

export interface FocusedFullscreenAPI {
  readonly isEnabled: boolean;
  readonly isFullscreen: boolean;
  readonly element?: Element;
  request(element: Element): Promise<void>;
  exit(): Promise<void>;
}

export const isFocusedCardFullscreen = (
  api: FocusedFullscreenAPI,
  element: Element,
): boolean => api.isEnabled && api.isFullscreen && api.element === element;

export const toggleFocusedCardFullscreen = async (
  api: FocusedFullscreenAPI,
  element: Element,
): Promise<void> => {
  if (!api.isEnabled) {
    throw new Error('Fullscreen is not supported by this browser.');
  }
  if (api.isFullscreen) {
    await api.exit();
  } else {
    await api.request(element);
  }
};

const buttonStyle = (button: FocusedOverlayButton, size: number) => ({
  left: `${button.x}%`,
  top: `${button.y}%`,
  width: `${size}px`,
  height: `${size}px`,
  '--focused-icon-size': `${Math.round(size * 0.65)}px`,
});

export const callUniFiPreset = async (
  hass: HomeAssistant,
  deviceID: string,
  preset: string,
): Promise<void> => {
  await hass.callService('unifiprotect', 'ptz_goto_preset', {
    device_id: deviceID,
    preset,
  });
};

@customElement('camera-card')
export class CameraCard extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @state()
  private _config?: RawFocusedConfig;

  @state()
  private _cameraIndex = 0;

  @state()
  private _hd = false;

  @state()
  private _elementsReady = Boolean(customElements.get('ha-camera-stream'));

  @state()
  private _fullscreen = false;

  @state()
  private _error = '';

  private _loadingElements?: Promise<void>;

  public static async getConfigElement(): Promise<CameraCardEditor> {
    await import('./editor.js');
    return document.createElement('camera-card-editor') as CameraCardEditor;
  }

  public static getStubConfig(
    _hass: HomeAssistant,
    entities: string[],
  ): Omit<RawFocusedConfig, 'type'> {
    const camera = entities.find((entity) => entity.startsWith('camera.')) ?? '';
    const model = createDefaultModel(camera);
    return {
      cameras: camera
        ? [
            {
              camera_entity: camera,
              title: camera,
              live_provider: 'ha',
            },
          ]
        : [],
      focused: model.settings,
    };
  }

  public setConfig(config: RawFocusedConfig): void {
    const model = normalizeFocusedConfig(config);
    if (!model.cameras.length) {
      throw new Error('Add at least one main camera stream.');
    }
    this._config = config;
    if (this._cameraIndex >= model.cameras.length) {
      this._cameraIndex = 0;
    }
    this._hd = this._hd && Boolean(model.cameras[this._cameraIndex]?.hd);
    void this._loadHomeAssistantElements(model.cameras[0]?.main);
  }

  public getCardSize(): number {
    return 6;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (screenfull.isEnabled) {
      screenfull.on('change', this._fullscreenChanged);
    }
  }

  public disconnectedCallback(): void {
    if (screenfull.isEnabled) {
      screenfull.off('change', this._fullscreenChanged);
    }
    super.disconnectedCallback();
  }

  private _fullscreenChanged = (): void => {
    this._fullscreen = isFocusedCardFullscreen(screenfull, this);
  };

  private async _loadHomeAssistantElements(cameraEntity = ''): Promise<void> {
    if (this._elementsReady || this._loadingElements) {
      return this._loadingElements;
    }
    this._loadingElements = (async () => {
      try {
        if (!customElements.get('ha-camera-stream')) {
          const helpers = await window.loadCardHelpers?.();
          await helpers?.createCardElement({
            type: 'picture-entity',
            entity: cameraEntity,
            camera_view: 'live',
          });
          await customElements.whenDefined('ha-camera-stream');
        }
        this._elementsReady = true;
      } catch (error) {
        this._error =
          error instanceof Error ? error.message : 'Could not load camera stream.';
      }
    })();
    return this._loadingElements;
  }

  private _getModel() {
    return this._config ? normalizeFocusedConfig(this._config) : null;
  }

  private _selectCamera(offset: number): void {
    const count = this._getModel()?.cameras.length ?? 0;
    if (count < 2) {
      return;
    }
    this._cameraIndex = (this._cameraIndex + offset + count) % count;
    this._hd = false;
    this._error = '';
  }

  private _toggleSubstream(): void {
    const pair = this._getModel()?.cameras[this._cameraIndex];
    if (pair?.hd) {
      this._hd = !this._hd;
      this._error = '';
    }
  }

  private async _toggleFullscreen(): Promise<void> {
    try {
      await toggleFocusedCardFullscreen(screenfull, this);
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Fullscreen failed.';
    }
  }

  private async _goToPreset(group: FocusedPresetGroup, preset: string): Promise<void> {
    if (!this.hass) {
      return;
    }
    try {
      await callUniFiPreset(this.hass, group.device_id, preset);
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Preset action failed.';
    }
  }

  private _renderOverlayButton(
    button: FocusedOverlayButton,
    size: number,
    label: string,
    action: () => void,
    active = false,
  ): TemplateResult | typeof nothing {
    if (!button.enabled) {
      return nothing;
    }
    return html`<button
      class="overlay-button ${active ? 'active' : ''}"
      style=${styleMap(buttonStyle(button, size))}
      title=${label}
      aria-label=${label}
      @click=${action}
    >
      <ha-icon icon=${active ? button.active_icon : button.icon}></ha-icon>
    </button>`;
  }

  private _renderPresets(
    group: FocusedPresetGroup,
    size: number,
  ): Array<TemplateResult | typeof nothing> {
    const centerOffset = (group.presets.length - 1) / 2;
    return group.presets.map((preset, index) =>
      this._renderOverlayButton(
        {
          enabled: true,
          icon: preset.icon,
          active_icon: preset.icon,
          x: Number(group.x) + (index - centerOffset) * Number(group.spacing),
          y: group.y,
        },
        size,
        preset.name,
        () => void this._goToPreset(group, preset.name),
      ),
    );
  }

  private _activeEntity(pair: FocusedCameraPair): string {
    return this._hd && pair.hd ? pair.hd : pair.main;
  }

  protected render(): TemplateResult {
    const model = this._getModel();
    const pair = model?.cameras[this._cameraIndex];
    if (!model || !pair || !this.hass) {
      return html``;
    }

    const entity = this._activeEntity(pair);
    const stateObj = this.hass.states[entity];
    const presetGroup = model.settings.preset_groups.find(
      (group) => group.camera === pair.main,
    );

    return html`<ha-card>
      <div class="camera ${this._fullscreen ? 'fullscreen' : ''}">
        ${!this._elementsReady
          ? html`<div class="message">Loading camera stream…</div>`
          : !stateObj
            ? html`<div class="message">Camera entity not found: ${entity}</div>`
            : stateObj.state === 'unavailable'
              ? html`<div class="message">${pair.title} is unavailable</div>`
              : html`<ha-camera-stream
                  .hass=${this.hass}
                  .stateObj=${stateObj}
                  .controls=${false}
                  .muted=${true}
                ></ha-camera-stream>`}
        ${model.cameras.length > 1
          ? html`
              <button
                class="navigation previous"
                title="Previous camera"
                aria-label="Previous camera"
                @click=${() => this._selectCamera(-1)}
              >
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </button>
              <button
                class="navigation next"
                title="Next camera"
                aria-label="Next camera"
                @click=${() => this._selectCamera(1)}
              >
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </button>
            `
          : nothing}
        ${pair.hd
          ? this._renderOverlayButton(
              model.settings.substream,
              model.settings.button_size,
              this._hd ? 'Use main stream' : 'Use HD stream',
              () => this._toggleSubstream(),
              this._hd,
            )
          : nothing}
        ${this._renderOverlayButton(
          model.settings.fullscreen,
          model.settings.button_size,
          this._fullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
          () => void this._toggleFullscreen(),
          this._fullscreen,
        )}
        ${presetGroup?.device_id
          ? this._renderPresets(presetGroup, model.settings.button_size)
          : nothing}
        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      </div>
    </ha-card>`;
  }

  static styles = css`
    :host {
      display: block;
    }

    ha-card,
    .camera {
      width: 100%;
      height: 100%;
    }

    .camera {
      position: relative;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: black;
      color: white;
    }

    .camera.fullscreen {
      width: 100vw;
      height: 100vh;
      aspect-ratio: auto;
    }

    ha-camera-stream {
      display: block;
      width: 100%;
      height: 100%;
    }

    .message {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--secondary-text-color, #bdbdbd);
      text-align: center;
    }

    button {
      border: 0;
      color: white;
      cursor: pointer;
    }

    .overlay-button {
      position: absolute;
      z-index: 3;
      display: grid;
      place-items: center;
      padding: 0;
      transform: translate(-50%, -50%);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.42);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
    }

    .overlay-button:hover,
    .overlay-button:focus-visible,
    .overlay-button.active {
      background: var(--primary-color, #03a9f4);
    }

    .overlay-button ha-icon {
      --mdc-icon-size: var(--focused-icon-size);
    }

    .navigation {
      position: absolute;
      top: 50%;
      z-index: 2;
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      padding: 0;
      transform: translateY(-50%);
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.25);
    }

    .navigation:hover,
    .navigation:focus-visible {
      background: rgba(0, 0, 0, 0.55);
    }

    .navigation.previous {
      left: 8px;
    }

    .navigation.next {
      right: 8px;
    }

    .navigation ha-icon {
      --mdc-icon-size: 32px;
    }

    .error {
      position: absolute;
      right: 8px;
      bottom: 8px;
      z-index: 4;
      max-width: calc(100% - 16px);
      padding: 6px 10px;
      border-radius: 4px;
      background: var(--error-color, #db4437);
      font-size: 12px;
    }
  `;
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: 'camera-card',
  name: 'Camera Card',
  description: 'Minimal HA live camera card with HD streams and PTZ presets.',
  preview: true,
});
