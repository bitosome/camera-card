import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import screenfull from 'screenfull';
import { createDefaultModel, normalizeFocusedConfig } from './config.js';
import type {
  FocusedCameraPair,
  CameraCardEditor,
  FocusedOverlayButton,
  FocusedPosition,
  FocusedPresetGroup,
  HomeAssistant,
  RawFocusedConfig,
} from './types.js';

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): Promise<HTMLElement>;
}

interface EntityRegistryEntry {
  config_entry_id?: string | null;
  platform?: string;
}

interface SignedPath {
  path: string;
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
): Promise<boolean> => {
  if (!api.isEnabled) {
    return false;
  }
  if (api.isFullscreen) {
    await api.exit();
  } else {
    await api.request(element);
  }
  return true;
};

interface PositionedOverlayButton extends FocusedOverlayButton {
  x: number;
  y: number;
  left?: string;
}

const RECORDING_CLIP_SECONDS = 10;
const RECORDING_SEEK_WINDOW_MINUTES = 30;

export const recordingClipWindow = (
  requestedStart: number,
  now = Date.now(),
): { start: Date; end: Date } => {
  const latestStart = now - RECORDING_CLIP_SECONDS * 1000;
  const start = Math.min(requestedStart, latestStart);
  return {
    start: new Date(start),
    end: new Date(Math.min(start + RECORDING_CLIP_SECONDS * 1000, now)),
  };
};

export const createUniFiRecordingPath = (
  configEntryID: string,
  cameraEntity: string,
  start: Date,
  end: Date,
): string =>
  `/api/unifiprotect/video/${encodeURIComponent(configEntryID)}/${encodeURIComponent(cameraEntity)}/${encodeURIComponent(start.toISOString())}/${encodeURIComponent(end.toISOString())}`;

export const toLocalDateTimeValue = (timestamp: number): string => {
  const date = new Date(timestamp);
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
};

export const recordingSeekWindow = (
  position: number,
  now = Date.now(),
): { start: number; end: number } => {
  const halfWindow = (RECORDING_SEEK_WINDOW_MINUTES * 60_000) / 2;
  const latest = now - RECORDING_CLIP_SECONDS * 1000;
  const end = Math.min(position + halfWindow, latest);
  return { start: end - halfWindow * 2, end };
};

export const groupedButtonLeft = (
  center: number,
  requestedSpacing: number,
  count: number,
  index: number,
  size: number,
): string => {
  const spacing = count > 1 ? Math.min(requestedSpacing, 80 / (count - 1)) : 0;
  const halfSpan = ((count - 1) * spacing) / 2;
  const safeCenter = `clamp(calc(${size / 2}px + ${halfSpan}%), ${center}%, calc(100% - ${size / 2}px - ${halfSpan}%))`;
  const offset = (index - (count - 1) / 2) * spacing;
  if (offset === 0) {
    return safeCenter;
  }
  return `calc(${safeCenter} ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}%)`;
};

export const resolvePercentage = (value: FocusedPosition, fallback: number): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && String(value).trim() !== ''
    ? Math.min(100, Math.max(0, number))
    : fallback;
};

const buttonStyle = (button: PositionedOverlayButton, size: number) => ({
  left: button.left ?? `clamp(${size / 2}px, ${button.x}%, calc(100% - ${size / 2}px))`,
  top: `clamp(${size / 2}px, ${button.y}%, calc(100% - ${size / 2}px))`,
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

  @state()
  private _activePresets: Record<string, string> = {};

  @state()
  private _recordingMode = false;

  @state()
  private _recordingStart = Date.now() - 5 * 60_000;

  @state()
  private _recordingUrl = '';

  @state()
  private _recordingLoading = false;

  @state()
  private _recordingPanelOpen = false;

  @state()
  private _recordingDateDraft = '';

  @state()
  private _recordingPaused = false;

  @state()
  private _recordingMuted = true;

  @state()
  private _recordingPosition = this._recordingStart;

  @state()
  private _recordingSeekStart = Date.now() - RECORDING_SEEK_WINDOW_MINUTES * 60_000;

  @state()
  private _recordingSeekEnd = Date.now() - RECORDING_CLIP_SECONDS * 1000;

  private _loadingElements?: Promise<void>;
  private _documentOverflow = '';
  private _recordingRequest = 0;
  private _recordingSeeking = false;
  private _configEntryIDs = new Map<string, string>();
  private _drawerPointerStart?: number;
  private _drawerDragged = false;

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
    this._recordingRequest += 1;
    this._setFallbackFullscreen(false);
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
    const model = this._getModel();
    const count = model?.cameras.length ?? 0;
    if (count < 2) {
      return;
    }
    const nextIndex = (this._cameraIndex + offset + count) % count;
    this._cameraIndex = nextIndex;
    this._hd = false;
    this._error = '';
    if (this._recordingMode && model) {
      void this._loadRecording(model.cameras[nextIndex].main);
    }
  }

  private _toggleSubstream(): void {
    const pair = this._getModel()?.cameras[this._cameraIndex];
    if (pair?.hd) {
      this._hd = !this._hd;
      this._error = '';
    }
  }

  private _closeRecording(): void {
    this._recordingRequest += 1;
    this._recordingMode = false;
    this._recordingUrl = '';
    this._recordingLoading = false;
    this._recordingPanelOpen = false;
    this._recordingDateDraft = '';
    this._recordingPaused = false;
    this._recordingMuted = true;
    this._recordingSeeking = false;
    this._recordingPosition = this._recordingStart;
    this._error = '';
  }

  private _toggleRecording(pair: FocusedCameraPair): void {
    if (this._recordingMode) {
      this._closeRecording();
      return;
    }
    this._recordingMode = true;
    this._recordingPanelOpen = false;
    this._recordingPaused = false;
    this._recordingMuted = true;
    this._recordingStart = Date.now() - 5 * 60_000;
    this._recordingPosition = this._recordingStart;
    this._setRecordingSeekWindow(this._recordingStart);
    void this._loadRecording(pair.main);
  }

  private async _configEntryID(cameraEntity: string): Promise<string> {
    const cached = this._configEntryIDs.get(cameraEntity);
    if (cached) {
      return cached;
    }
    if (!this.hass?.callWS) {
      throw new Error('Home Assistant recording API is unavailable.');
    }
    const entry = await this.hass.callWS<EntityRegistryEntry>({
      type: 'config/entity_registry/get',
      entity_id: cameraEntity,
    });
    if (entry.platform !== 'unifiprotect' || !entry.config_entry_id) {
      throw new Error('Recordings require a UniFi Protect camera entity.');
    }
    this._configEntryIDs.set(cameraEntity, entry.config_entry_id);
    return entry.config_entry_id;
  }

  private async _loadRecording(cameraEntity: string): Promise<void> {
    if (!this.hass || !this._recordingMode) {
      return;
    }
    const request = ++this._recordingRequest;
    this._recordingLoading = true;
    this._recordingUrl = '';
    this._error = '';
    try {
      const configEntryID = await this._configEntryID(cameraEntity);
      const { start, end } = recordingClipWindow(this._recordingStart);
      this._recordingStart = start.getTime();
      this._recordingPosition = this._recordingStart;
      const unsignedPath = createUniFiRecordingPath(
        configEntryID,
        cameraEntity,
        start,
        end,
      );
      const signed = await this.hass.callWS<SignedPath>({
        type: 'auth/sign_path',
        path: unsignedPath,
        expires: 3600,
      });
      if (request === this._recordingRequest && this._recordingMode) {
        this._recordingUrl = signed.path;
      }
    } catch (error) {
      if (request === this._recordingRequest) {
        this._recordingLoading = false;
        this._error =
          error instanceof Error ? error.message : 'Could not load recording.';
      }
    }
  }

  private _selectRecordingTime(
    timestamp: number,
    cameraEntity: string,
    resetSeekWindow = false,
  ): void {
    if (!Number.isFinite(timestamp)) {
      return;
    }
    this._recordingStart = Math.min(
      timestamp,
      Date.now() - RECORDING_CLIP_SECONDS * 1000,
    );
    this._recordingPosition = this._recordingStart;
    if (
      resetSeekWindow ||
      this._recordingStart < this._recordingSeekStart ||
      this._recordingStart > this._recordingSeekEnd
    ) {
      this._setRecordingSeekWindow(this._recordingStart);
    }
    void this._loadRecording(cameraEntity);
  }

  private _advanceRecording(cameraEntity: string): void {
    this._selectRecordingTime(
      this._recordingStart + RECORDING_CLIP_SECONDS * 1000,
      cameraEntity,
    );
  }

  private _seekRecording(seconds: number, cameraEntity: string): void {
    this._selectRecordingTime(this._recordingPosition + seconds * 1000, cameraEntity);
  }

  private async _toggleRecordingPlayback(): Promise<void> {
    const video = this.renderRoot.querySelector<HTMLVideoElement>('.recording-video');
    if (!video) {
      return;
    }
    if (this._recordingPaused) {
      try {
        await video.play();
        this._recordingPaused = false;
        this._error = '';
      } catch {
        this._error = 'The browser prevented recording playback.';
      }
    } else {
      video.pause();
      this._recordingPaused = true;
    }
  }

  private _toggleRecordingMute(): void {
    this._recordingMuted = !this._recordingMuted;
    const video = this.renderRoot.querySelector<HTMLVideoElement>('.recording-video');
    if (video) {
      video.muted = this._recordingMuted;
    }
  }

  private _recordingCanPlay(event: Event): void {
    const video = event.currentTarget as HTMLVideoElement;
    this._recordingLoading = false;
    video.muted = this._recordingMuted;
    if (!this._recordingPaused) {
      void video.play().catch(() => {
        this._recordingPaused = true;
      });
    }
  }

  private _setRecordingSeekWindow(position: number): void {
    const window = recordingSeekWindow(position);
    this._recordingSeekStart = window.start;
    this._recordingSeekEnd = window.end;
  }

  private _recordingTimeUpdate(event: Event): void {
    if (this._recordingSeeking) {
      return;
    }
    const video = event.currentTarget as HTMLVideoElement;
    const position = this._recordingStart + video.currentTime * 1000;
    if (Math.abs(position - this._recordingPosition) >= 500) {
      this._recordingPosition = position;
    }
  }

  private _drawerPointerDown(event: PointerEvent): void {
    this._drawerPointerStart = event.clientX;
    this._drawerDragged = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private _drawerPointerUp(event: PointerEvent): void {
    if (this._drawerPointerStart === undefined) {
      return;
    }
    const distance = event.clientX - this._drawerPointerStart;
    this._drawerPointerStart = undefined;
    if (Math.abs(distance) < 20) {
      return;
    }
    this._drawerDragged = true;
    if (distance < 0) {
      this._setRecordingPanel(true);
    } else {
      this._setRecordingPanel(false);
    }
  }

  private _drawerClick(): void {
    if (this._drawerDragged) {
      this._drawerDragged = false;
      return;
    }
    this._setRecordingPanel(!this._recordingPanelOpen);
  }

  private _setRecordingPanel(open: boolean): void {
    this._recordingPanelOpen = open;
    if (open) {
      this._recordingDateDraft = toLocalDateTimeValue(this._recordingStart);
    }
  }

  private async _toggleFullscreen(): Promise<void> {
    if (this.hasAttribute('data-fullscreen-fallback')) {
      this._setFallbackFullscreen(false);
      return;
    }
    try {
      const nativeFullscreen = await toggleFocusedCardFullscreen(screenfull, this);
      if (!nativeFullscreen) {
        this._setFallbackFullscreen(true);
      }
    } catch {
      this._setFallbackFullscreen(true);
    }
  }

  private _setFallbackFullscreen(active: boolean): void {
    if (active === this.hasAttribute('data-fullscreen-fallback')) {
      return;
    }
    if (active) {
      this._documentOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      this.setAttribute('data-fullscreen-fallback', '');
    } else {
      document.documentElement.style.overflow = this._documentOverflow;
      this.removeAttribute('data-fullscreen-fallback');
    }
    this._fullscreen = active;
    this._error = '';
  }

  private async _goToPreset(group: FocusedPresetGroup, preset: string): Promise<void> {
    if (!this.hass) {
      return;
    }
    try {
      await callUniFiPreset(this.hass, group.device_id, preset);
      this._activePresets = { ...this._activePresets, [group.camera]: preset };
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Preset action failed.';
    }
  }

  private _renderOverlayButton(
    button: PositionedOverlayButton,
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
    return group.presets.map((preset, index) =>
      this._renderOverlayButton(
        {
          enabled: true,
          icon: preset.icon,
          active_icon: preset.icon,
          x:
            resolvePercentage(group.x, 50) +
            (index - (group.presets.length - 1) / 2) *
              resolvePercentage(group.spacing, 12),
          y: resolvePercentage(group.y, 88),
          left: groupedButtonLeft(
            resolvePercentage(group.x, 50),
            resolvePercentage(group.spacing, 12),
            group.presets.length,
            index,
            size,
          ),
        },
        size,
        preset.name,
        () => void this._goToPreset(group, preset.name),
        this._activePresets[group.camera] === preset.name,
      ),
    );
  }

  private _renderControls(
    pair: FocusedCameraPair,
    model: ReturnType<typeof normalizeFocusedConfig>,
  ): Array<TemplateResult | typeof nothing> {
    const controls = [
      ...(pair.hd && model.settings.substream.enabled && !this._recordingMode
        ? [
            {
              button: model.settings.substream,
              label: this._hd ? 'Use main stream' : 'Use HD stream',
              action: () => this._toggleSubstream(),
              active: this._hd,
            },
          ]
        : []),
      ...(model.settings.recording.enabled
        ? [
            {
              button: model.settings.recording,
              label: this._recordingMode ? 'Return to live view' : 'View recordings',
              action: () => this._toggleRecording(pair),
              active: this._recordingMode,
            },
          ]
        : []),
      ...(model.settings.fullscreen.enabled
        ? [
            {
              button: model.settings.fullscreen,
              label: this._fullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
              action: () => void this._toggleFullscreen(),
              active: this._fullscreen,
            },
          ]
        : []),
    ];
    const center = resolvePercentage(model.settings.controls.x, 90);
    const y = resolvePercentage(model.settings.controls.y, 8);
    const spacing = resolvePercentage(model.settings.controls.spacing, 8);
    return controls.map((control, index) =>
      this._renderOverlayButton(
        {
          ...control.button,
          enabled: true,
          x: center + (index - (controls.length - 1) / 2) * spacing,
          y,
          left: groupedButtonLeft(
            center,
            spacing,
            controls.length,
            index,
            model.settings.button_size,
          ),
        },
        model.settings.button_size,
        control.label,
        control.action,
        control.active,
      ),
    );
  }

  private _activeEntity(pair: FocusedCameraPair): string {
    return this._hd && pair.hd ? pair.hd : pair.main;
  }

  private _renderRecordingControls(pair: FocusedCameraPair): TemplateResult {
    const now = Date.now();
    return html`<button
        class="recording-pull-tab"
        title=${this._recordingPanelOpen
          ? 'Hide recording time selector'
          : 'Show recording time selector'}
        aria-label=${this._recordingPanelOpen
          ? 'Hide recording time selector'
          : 'Show recording time selector'}
        aria-expanded=${this._recordingPanelOpen ? 'true' : 'false'}
        @pointerdown=${this._drawerPointerDown}
        @pointerup=${this._drawerPointerUp}
        @pointercancel=${() => {
          this._drawerPointerStart = undefined;
          this._drawerDragged = false;
        }}
        @click=${this._drawerClick}
      >
        <ha-icon
          icon=${this._recordingPanelOpen ? 'mdi:chevron-right' : 'mdi:calendar-clock'}
        ></ha-icon>
      </button>
      <div class="recording-drawer ${this._recordingPanelOpen ? 'open' : ''}">
        ${this._recordingPanelOpen
          ? html`<label class="recording-date-selector">
              <span>Jump to recording time</span>
              <input
                class="recording-datetime"
                type="datetime-local"
                aria-label="Recording date and time"
                .value=${this._recordingDateDraft}
                max=${toLocalDateTimeValue(now - RECORDING_CLIP_SECONDS * 1000)}
                @input=${(event: Event) => {
                  this._recordingDateDraft = (
                    event.currentTarget as HTMLInputElement
                  ).value;
                }}
                @change=${(event: Event) => {
                  const value = (event.currentTarget as HTMLInputElement).value;
                  const timestamp = new Date(value).getTime();
                  if (Number.isFinite(timestamp)) {
                    this._selectRecordingTime(timestamp, pair.main, true);
                    this._setRecordingPanel(false);
                  }
                }}
              />
            </label>`
          : nothing}
      </div>`;
  }

  private _renderRecordingPlayer(pair: FocusedCameraPair): TemplateResult {
    const position = Math.min(
      this._recordingSeekEnd,
      Math.max(this._recordingSeekStart, this._recordingPosition),
    );
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(
      position,
    );
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(
      position,
    );

    return html`<div class="recording-player">
      <div class="recording-timeline">
        <input
          type="range"
          min=${String(Math.floor(this._recordingSeekStart / 1000))}
          max=${String(Math.floor(this._recordingSeekEnd / 1000))}
          step="1"
          .value=${String(Math.floor(position / 1000))}
          aria-label="Recording playback time"
          @input=${(event: Event) => {
            this._recordingSeeking = true;
            this._recordingPosition =
              Number((event.currentTarget as HTMLInputElement).value) * 1000;
          }}
          @change=${(event: Event) => {
            this._recordingSeeking = false;
            this._selectRecordingTime(
              Number((event.currentTarget as HTMLInputElement).value) * 1000,
              pair.main,
            );
          }}
        />
        <time datetime=${new Date(position).toISOString()}>
          <span class="recording-date">${date}</span>
          <span>${time}</span>
        </time>
      </div>
      <div class="recording-player-actions">
        <button
          class="player-action"
          title="Previous 10 seconds"
          aria-label="Previous 10 seconds"
          @click=${() => this._seekRecording(-RECORDING_CLIP_SECONDS, pair.main)}
        >
          <ha-icon icon="mdi:rewind-10"></ha-icon>
        </button>
        <button
          class="player-action player-primary"
          title=${this._recordingPaused ? 'Play recording' : 'Pause recording'}
          aria-label=${this._recordingPaused ? 'Play recording' : 'Pause recording'}
          @click=${() => void this._toggleRecordingPlayback()}
        >
          <ha-icon icon=${this._recordingPaused ? 'mdi:play' : 'mdi:pause'}></ha-icon>
        </button>
        <button
          class="player-action"
          title="Next 10 seconds"
          aria-label="Next 10 seconds"
          @click=${() => this._seekRecording(RECORDING_CLIP_SECONDS, pair.main)}
        >
          <ha-icon icon="mdi:fast-forward-10"></ha-icon>
        </button>
        <button
          class="player-action"
          title=${this._recordingMuted ? 'Unmute recording' : 'Mute recording'}
          aria-label=${this._recordingMuted ? 'Unmute recording' : 'Mute recording'}
          @click=${this._toggleRecordingMute}
        >
          <ha-icon
            icon=${this._recordingMuted ? 'mdi:volume-off' : 'mdi:volume-high'}
          ></ha-icon>
        </button>
        <button
          class="live-action"
          title="Return to live view"
          aria-label="Return to live view"
          @click=${this._closeRecording}
        >
          <span class="live-dot"></span>Live
        </button>
      </div>
    </div>`;
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
        ${this._recordingMode
          ? this._recordingUrl
            ? html`<video
                class="recording-video"
                src=${this._recordingUrl}
                ?autoplay=${!this._recordingPaused}
                .muted=${this._recordingMuted}
                playsinline
                aria-label="Recording video"
                @click=${() => void this._toggleRecordingPlayback()}
                @canplay=${this._recordingCanPlay}
                @play=${() => (this._recordingPaused = false)}
                @pause=${(event: Event) => {
                  const video = event.currentTarget as HTMLVideoElement;
                  if (!this._recordingLoading && !video.ended) {
                    this._recordingPaused = true;
                  }
                }}
                @timeupdate=${this._recordingTimeUpdate}
                @ended=${() => this._advanceRecording(pair.main)}
                @error=${() => {
                  this._recordingLoading = false;
                  this._error =
                    'Recording could not be played. UniFi Protect media requires Full access mode and available footage.';
                }}
              ></video>`
            : nothing
          : !this._elementsReady
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
        ${this._recordingMode && this._recordingLoading
          ? html`<div class="message recording-loading">Loading recording…</div>`
          : nothing}
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
        ${this._renderControls(pair, model)}
        ${this._recordingMode ? this._renderRecordingPlayer(pair) : nothing}
        ${this._recordingMode ? this._renderRecordingControls(pair) : nothing}
        ${!this._recordingMode && presetGroup?.device_id
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

    :host([data-fullscreen-fallback]) {
      position: fixed;
      inset: 0;
      z-index: 10000;
      width: 100vw;
      height: 100dvh;
      background: black;
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
      height: 100dvh;
      aspect-ratio: auto;
    }

    ha-camera-stream {
      display: block;
      width: 100%;
      height: 100%;
    }

    .recording-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: black;
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

    .recording-loading {
      z-index: 1;
      pointer-events: none;
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

    .recording-drawer {
      position: absolute;
      top: 50%;
      right: 48px;
      z-index: 4;
      display: grid;
      width: min(300px, calc(100% - 64px));
      padding: 10px;
      transform: translate(calc(100% + 60px), -50%);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.66);
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      transition: transform 180ms ease;
      box-sizing: border-box;
    }

    .recording-drawer.open {
      transform: translate(0, -50%);
    }

    .recording-pull-tab {
      position: absolute;
      top: 32%;
      right: 0;
      z-index: 5;
      display: grid;
      width: 44px;
      height: 52px;
      place-items: center;
      padding: 0;
      transform: translateY(-50%);
      border-radius: 8px 0 0 8px;
      background: rgba(0, 0, 0, 0.66);
      box-shadow: -1px 1px 4px rgba(0, 0, 0, 0.3);
      touch-action: none;
    }

    .recording-pull-tab ha-icon {
      --mdc-icon-size: 24px;
    }

    .recording-date-selector {
      display: grid;
      gap: 6px;
      font-size: 12px;
    }

    .recording-date-selector span {
      color: var(--secondary-text-color, #bdbdbd);
    }

    .recording-datetime {
      width: 100%;
      height: 34px;
      padding: 0 8px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 4px;
      color: white;
      color-scheme: dark;
      background: rgba(0, 0, 0, 0.18);
      font: inherit;
      box-sizing: border-box;
    }

    .recording-player {
      position: absolute;
      right: 8px;
      bottom: 8px;
      left: 8px;
      z-index: 3;
      display: grid;
      gap: 4px;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.66);
      backdrop-filter: blur(6px);
      box-sizing: border-box;
    }

    .recording-timeline,
    .recording-player-actions {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 6px;
    }

    .recording-timeline input {
      min-width: 60px;
      flex: 1;
      accent-color: var(--primary-color, #03a9f4);
    }

    .recording-timeline time {
      display: flex;
      min-width: max-content;
      gap: 4px;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .player-action,
    .live-action {
      display: inline-flex;
      min-width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.14);
    }

    .player-action ha-icon {
      --mdc-icon-size: 22px;
    }

    .player-primary {
      background: var(--primary-color, #03a9f4);
    }

    .live-action {
      gap: 6px;
      margin-left: auto;
      font-weight: 600;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--error-color, #db4437);
    }

    @media (max-width: 600px) {
      .recording-drawer {
        right: 46px;
        width: calc(100% - 58px);
        padding: 8px;
      }

      .recording-datetime {
        height: 32px;
        font-size: 12px;
      }

      .recording-player {
        right: 6px;
        bottom: 6px;
        left: 6px;
        padding: 5px 6px;
      }

      .recording-timeline,
      .recording-player-actions {
        gap: 4px;
      }

      .recording-date {
        display: none;
      }

      .recording-timeline time {
        font-size: 11px;
      }

      .player-action,
      .live-action {
        min-width: 32px;
        height: 32px;
        padding: 0 6px;
      }

      .live-action {
        font-size: 12px;
      }
    }
  `;
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: 'camera-card',
  name: 'Camera Card',
  description: 'Minimal HA camera card with UniFi Protect recordings and PTZ presets.',
  preview: true,
});
