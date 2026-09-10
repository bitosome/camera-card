import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  createDefaultModel,
  normalizeFocusedConfig,
  serializeFocusedConfig,
} from './config.js';
import type {
  FocusedCameraPair,
  FocusedControlGroup,
  FocusedModel,
  FocusedOverlayButton,
  FocusedPreset,
  FocusedPresetGroup,
  HomeAssistant,
  RawFocusedConfig,
} from './types.js';

type FormValue = string | number | boolean;
type FormData = Record<string, FormValue>;

interface FormSchema {
  name: string;
  required?: boolean;
  selector?: Record<string, Record<string, unknown>>;
  type?: 'grid';
  flatten?: boolean;
  column_min_width?: string;
  schema?: readonly FormSchema[];
  visible?: {
    field: string;
    operator: 'eq';
    value: FormValue;
  };
}

type ItemMovedEvent = CustomEvent<{ oldIndex: number; newIndex: number }>;

const cloneModel = (model: FocusedModel): FocusedModel => structuredClone(model);

const textSelector = (): FormSchema['selector'] => ({ text: {} });
const iconSelector = (placeholder: string): FormSchema['selector'] => ({
  icon: { placeholder },
});
const cameraSelector = (): FormSchema['selector'] => ({
  entity: { filter: { domain: 'camera' } },
});
const positionSelector = (): FormSchema['selector'] => ({
  text: { suffix: '%' },
});

const CAMERA_SCHEMA: readonly FormSchema[] = [
  { name: 'title', selector: textSelector() },
  { name: 'main', required: true, selector: cameraSelector() },
  { name: 'hd', selector: cameraSelector() },
];

const BUTTON_SCHEMA: readonly FormSchema[] = [
  { name: 'enabled', selector: { boolean: {} } },
  {
    type: 'grid',
    name: '',
    flatten: true,
    column_min_width: '180px',
    visible: { field: 'enabled', operator: 'eq', value: true },
    schema: [
      { name: 'icon', required: true, selector: iconSelector('mdi:cctv') },
      {
        name: 'active_icon',
        required: true,
        selector: iconSelector('mdi:check-circle'),
      },
    ],
  },
];

const CONTROL_SCHEMA: readonly FormSchema[] = [
  {
    type: 'grid',
    name: '',
    flatten: true,
    column_min_width: '140px',
    schema: [
      { name: 'x', selector: positionSelector() },
      { name: 'y', selector: positionSelector() },
      { name: 'spacing', selector: positionSelector() },
    ],
  },
];

const SIZE_SCHEMA: readonly FormSchema[] = [
  {
    name: 'button_size',
    required: true,
    selector: {
      number: {
        min: 24,
        max: 80,
        step: 1,
        mode: 'box',
        unit_of_measurement: 'px',
      },
    },
  },
];

const PRESET_SCHEMA: readonly FormSchema[] = [
  {
    type: 'grid',
    name: '',
    flatten: true,
    column_min_width: '190px',
    schema: [
      { name: 'name', required: true, selector: textSelector() },
      { name: 'icon', required: true, selector: iconSelector('mdi:cctv') },
    ],
  },
];

const CAMERA_LABELS: Record<string, string> = {
  title: 'Camera name',
  main: 'Main stream',
  hd: 'HD stream (optional)',
};

const BUTTON_LABELS: Record<string, string> = {
  enabled: 'Show button',
  icon: 'Normal icon',
  active_icon: 'Active icon',
};

const CONTROL_LABELS: Record<string, string> = {
  x: 'Row center',
  y: 'Vertical position',
  spacing: 'Button spacing',
};

const PRESET_LABELS: Record<string, string> = {
  name: 'Preset name',
  icon: 'Preset icon',
};

@customElement('camera-card-editor')
export class CameraCardEditor extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @state()
  private _model: FocusedModel = createDefaultModel();

  private _type = 'custom:camera-card';

  public setConfig(config: RawFocusedConfig): void {
    this._type = config.type || this._type;
    const model = normalizeFocusedConfig(config);
    this._model = model.cameras.length ? model : createDefaultModel();
  }

  private _emit(model: FocusedModel): void {
    this._model = model;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: serializeFocusedConfig(model, this._type) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _mutate(mutator: (model: FocusedModel) => void): void {
    const model = cloneModel(this._model);
    mutator(model);
    this._emit(model);
  }

  private _unusedCameraEntity(): string {
    const used = new Set(
      this._model.cameras.flatMap((camera) => [camera.main, camera.hd]),
    );
    const cameraEntities = Object.keys(this.hass?.states ?? {}).filter((entity) =>
      entity.startsWith('camera.'),
    );
    return cameraEntities.find((entity) => !used.has(entity)) ?? cameraEntities[0] ?? '';
  }

  private _addCamera(): void {
    const entity = this._unusedCameraEntity();
    this._mutate((model) =>
      model.cameras.push({
        title: entity || `Camera ${model.cameras.length + 1}`,
        main: entity,
        hd: '',
      }),
    );
  }

  private _updateCamera(index: number, value: FocusedCameraPair): void {
    const oldMain = this._model.cameras[index].main;
    this._mutate((model) => {
      model.cameras[index] = value;
      if (value.main !== oldMain) {
        for (const group of model.settings.preset_groups) {
          if (group.camera === oldMain) {
            group.camera = value.main;
          }
        }
      }
    });
  }

  private _moveCamera(oldIndex: number, newIndex: number): void {
    if (
      oldIndex === newIndex ||
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= this._model.cameras.length ||
      newIndex >= this._model.cameras.length
    ) {
      return;
    }
    this._mutate((model) => {
      const [moved] = model.cameras.splice(oldIndex, 1);
      model.cameras.splice(newIndex, 0, moved);
    });
  }

  private _removeCamera(index: number): void {
    if (this._model.cameras.length === 1) {
      return;
    }
    const removedEntity = this._model.cameras[index].main;
    this._mutate((model) => {
      model.cameras.splice(index, 1);
      model.settings.preset_groups = model.settings.preset_groups.filter(
        (group) => group.camera !== removedEntity,
      );
    });
  }

  private _updateButton(
    button: 'substream' | 'recording' | 'fullscreen',
    value: FocusedOverlayButton,
  ): void {
    this._mutate((model) => {
      model.settings[button] = value;
    });
  }

  private _updateControls(value: FocusedControlGroup): void {
    this._mutate((model) => {
      model.settings.controls = value;
    });
  }

  private _addPresetGroup(): void {
    const used = new Set(
      this._model.settings.preset_groups.map((group) => group.camera),
    );
    const camera =
      this._model.cameras.find((pair) => pair.main && !used.has(pair.main))?.main ??
      this._model.cameras[0]?.main ??
      '';
    this._mutate((model) =>
      model.settings.preset_groups.push({
        camera,
        device_id: '',
        x: 50,
        y: 88,
        spacing: 12,
        presets: [{ name: 'Home', icon: 'mdi:home' }],
      }),
    );
  }

  private _updatePresetGroup(
    groupIndex: number,
    value: Omit<FocusedPresetGroup, 'presets'>,
  ): void {
    this._mutate((model) => {
      const presets = model.settings.preset_groups[groupIndex].presets;
      model.settings.preset_groups[groupIndex] = { ...value, presets };
    });
  }

  private _addPreset(groupIndex: number): void {
    this._mutate((model) =>
      model.settings.preset_groups[groupIndex].presets.push({
        name: `Preset ${model.settings.preset_groups[groupIndex].presets.length + 1}`,
        icon: 'mdi:cctv',
      }),
    );
  }

  private _updatePreset(
    groupIndex: number,
    presetIndex: number,
    value: FocusedPreset,
  ): void {
    this._mutate((model) => {
      model.settings.preset_groups[groupIndex].presets[presetIndex] = value;
    });
  }

  private _movePreset(groupIndex: number, oldIndex: number, newIndex: number): void {
    const presets = this._model.settings.preset_groups[groupIndex]?.presets ?? [];
    if (
      oldIndex === newIndex ||
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= presets.length ||
      newIndex >= presets.length
    ) {
      return;
    }
    this._mutate((model) => {
      const target = model.settings.preset_groups[groupIndex].presets;
      const [moved] = target.splice(oldIndex, 1);
      target.splice(newIndex, 0, moved);
    });
  }

  private _form<T extends FormData>(
    data: T,
    schema: readonly FormSchema[],
    labels: Record<string, string>,
    changed: (value: T) => void,
    helpers: Record<string, string> = {},
  ): TemplateResult {
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .computeLabel=${(field: FormSchema) => labels[field.name]}
      .computeHelper=${(field: FormSchema) => helpers[field.name]}
      @value-changed=${(event: CustomEvent<{ value: T }>) => {
        event.stopPropagation();
        changed(event.detail.value);
      }}
    ></ha-form>`;
  }

  private _iconButton(
    icon: string,
    label: string,
    action: () => void,
    disabled = false,
  ): TemplateResult {
    return html`<ha-icon-button .label=${label} ?disabled=${disabled} @click=${action}>
      <ha-icon icon=${icon}></ha-icon>
    </ha-icon-button>`;
  }

  private _renderCameras(): TemplateResult {
    return html`<section>
      <h3>Camera streams</h3>
      <p class="helper">
        Add one main stream and an optional HD stream for each camera. Drag rows or use
        the arrow buttons to set the camera navigation order.
      </p>
      <ha-sortable
        handle-selector=".handle"
        @item-moved=${(event: ItemMovedEvent) => {
          event.stopPropagation();
          this._moveCamera(event.detail.oldIndex, event.detail.newIndex);
        }}
      >
        <div class="items">
          ${this._model.cameras.map(
            (camera, index) =>
              html`<div class="item">
                <div class="item-header">
                  <span class="handle" title="Drag to reorder">
                    <ha-icon icon="mdi:drag-horizontal-variant"></ha-icon>
                  </span>
                  <div class="item-heading">
                    <strong>${camera.title || `Camera ${index + 1}`}</strong>
                    <span>Camera ${index + 1} of ${this._model.cameras.length}</span>
                  </div>
                  <div class="item-actions">
                    ${this._iconButton(
                      'mdi:arrow-up',
                      'Move camera up',
                      () => this._moveCamera(index, index - 1),
                      index === 0,
                    )}
                    ${this._iconButton(
                      'mdi:arrow-down',
                      'Move camera down',
                      () => this._moveCamera(index, index + 1),
                      index === this._model.cameras.length - 1,
                    )}
                    ${this._iconButton(
                      'mdi:delete-outline',
                      'Remove camera',
                      () => this._removeCamera(index),
                      this._model.cameras.length === 1,
                    )}
                  </div>
                </div>
                ${this._form(
                  camera as unknown as FormData,
                  CAMERA_SCHEMA,
                  CAMERA_LABELS,
                  (value) =>
                    this._updateCamera(index, value as unknown as FocusedCameraPair),
                  {
                    main: 'Camera entity used by default.',
                    hd: 'Optional higher-resolution camera entity for the HD button.',
                  },
                )}
              </div>`,
          )}
        </div>
      </ha-sortable>
      <ha-button appearance="filled" size="s" @click=${this._addCamera}>
        <ha-icon slot="start" icon="mdi:plus"></ha-icon>
        Add camera
      </ha-button>
    </section>`;
  }

  private _renderButtonEditor(
    key: 'substream' | 'recording' | 'fullscreen',
    title: string,
    helper: string,
    activeIconLabel: string,
  ): TemplateResult {
    return html`<div class="subsection">
      <h4>${title}</h4>
      <p class="helper">${helper}</p>
      ${this._form(
        this._model.settings[key] as unknown as FormData,
        BUTTON_SCHEMA,
        { ...BUTTON_LABELS, active_icon: activeIconLabel },
        (value) => this._updateButton(key, value as unknown as FocusedOverlayButton),
        {
          icon: 'Icon shown while the mode is off.',
          active_icon: 'Icon shown while HD or fullscreen mode is active.',
        },
      )}
    </div>`;
  }

  private _presetGroupSchema(): readonly FormSchema[] {
    return [
      {
        type: 'grid',
        name: '',
        flatten: true,
        column_min_width: '180px',
        schema: [
          {
            name: 'camera',
            required: true,
            selector: {
              select: {
                mode: 'dropdown',
                options: this._model.cameras.map((camera) => ({
                  value: camera.main,
                  label: camera.title || camera.main,
                })),
              },
            },
          },
          {
            name: 'device_id',
            required: true,
            selector: { device: { filter: { integration: 'unifiprotect' } } },
          },
          { name: 'x', selector: positionSelector() },
          { name: 'y', selector: positionSelector() },
          { name: 'spacing', selector: positionSelector() },
        ],
      },
    ];
  }

  private _renderPreset(
    groupIndex: number,
    preset: FocusedPreset,
    presetIndex: number,
    presetCount: number,
  ): TemplateResult {
    return html`<div class="preset-item">
      <span class="handle" title="Drag to reorder">
        <ha-icon icon="mdi:drag-horizontal-variant"></ha-icon>
      </span>
      <div class="preset-form">
        ${this._form(
          preset as unknown as FormData,
          PRESET_SCHEMA,
          PRESET_LABELS,
          (value) =>
            this._updatePreset(
              groupIndex,
              presetIndex,
              value as unknown as FocusedPreset,
            ),
          {
            name: 'Must exactly match the preset name in UniFi Protect.',
            icon: 'Icon displayed on the camera.',
          },
        )}
      </div>
      <div class="item-actions">
        ${this._iconButton(
          'mdi:arrow-up',
          'Move preset up',
          () => this._movePreset(groupIndex, presetIndex, presetIndex - 1),
          presetIndex === 0,
        )}
        ${this._iconButton(
          'mdi:arrow-down',
          'Move preset down',
          () => this._movePreset(groupIndex, presetIndex, presetIndex + 1),
          presetIndex === presetCount - 1,
        )}
        ${this._iconButton('mdi:delete-outline', 'Remove preset', () =>
          this._mutate((model) =>
            model.settings.preset_groups[groupIndex].presets.splice(presetIndex, 1),
          ),
        )}
      </div>
    </div>`;
  }

  private _renderPresetGroups(): TemplateResult {
    return html`<section>
      <h3>Preset controls</h3>
      <p class="helper">
        A preset row belongs to one camera and one UniFi Protect PTZ device. Each preset
        below needs the exact UniFi preset name and the icon to show.
      </p>
      <div class="items">
        ${this._model.settings.preset_groups.map(
          (group, groupIndex) =>
            html`<div class="item">
              <div class="item-header">
                <div class="item-heading no-handle">
                  <strong>Preset row ${groupIndex + 1}</strong>
                  <span>${group.presets.length} configured presets</span>
                </div>
                <div class="item-actions">
                  ${this._iconButton('mdi:delete-outline', 'Remove preset row', () =>
                    this._mutate((model) =>
                      model.settings.preset_groups.splice(groupIndex, 1),
                    ),
                  )}
                </div>
              </div>
              ${this._form(
                {
                  camera: group.camera,
                  device_id: group.device_id,
                  x: group.x,
                  y: group.y,
                  spacing: group.spacing,
                },
                this._presetGroupSchema(),
                {
                  camera: 'Camera',
                  device_id: 'UniFi Protect PTZ device',
                  x: 'Row center',
                  y: 'Vertical position',
                  spacing: 'Icon spacing',
                },
                (value) =>
                  this._updatePresetGroup(
                    groupIndex,
                    value as Omit<FocusedPresetGroup, 'presets'>,
                  ),
                {
                  camera: 'The preset row appears only for this camera.',
                  device_id: 'Device that receives the PTZ preset action.',
                  x: 'Horizontal center of the complete preset row.',
                  y: 'Percentage from the top edge of the camera.',
                  spacing: 'Percentage between adjacent preset icons.',
                },
              )}
              <div class="preset-heading">
                <strong>Presets</strong>
                <span>Name and icon are configured separately for every preset.</span>
              </div>
              <ha-sortable
                handle-selector=".handle"
                @item-moved=${(event: ItemMovedEvent) => {
                  event.stopPropagation();
                  this._movePreset(
                    groupIndex,
                    event.detail.oldIndex,
                    event.detail.newIndex,
                  );
                }}
              >
                <div class="preset-list">
                  ${group.presets.map((preset, presetIndex) =>
                    this._renderPreset(
                      groupIndex,
                      preset,
                      presetIndex,
                      group.presets.length,
                    ),
                  )}
                </div>
              </ha-sortable>
              <ha-button
                appearance="outlined"
                size="s"
                @click=${() => this._addPreset(groupIndex)}
              >
                <ha-icon slot="start" icon="mdi:plus"></ha-icon>
                Add preset
              </ha-button>
            </div>`,
        )}
      </div>
      <ha-button appearance="filled" size="s" @click=${this._addPresetGroup}>
        <ha-icon slot="start" icon="mdi:plus"></ha-icon>
        Add preset row
      </ha-button>
    </section>`;
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass) {
      return nothing;
    }
    return html`<div class="editor">
      ${this._renderCameras()}
      <section>
        <h3>Overlay controls</h3>
        <p class="helper">
          Icons use Home Assistant's native icon picker. Positions are percentages of the
          camera surface so they remain responsive.
        </p>
        ${this._form(
          { button_size: this._model.settings.button_size },
          SIZE_SCHEMA,
          { button_size: 'Button size' },
          (value) =>
            this._mutate(
              (model) => (model.settings.button_size = value.button_size as number),
            ),
        )}
        <div class="subsection">
          <h4>Control row</h4>
          <p class="helper">
            Controls the center, vertical position, and spacing of the HD/SD, recording,
            and fullscreen icons as one row. The complete row stays inside the camera
            edge.
          </p>
          ${this._form(
            this._model.settings.controls as unknown as FormData,
            CONTROL_SCHEMA,
            CONTROL_LABELS,
            (value) => this._updateControls(value as unknown as FocusedControlGroup),
            {
              x: 'Horizontal center of the complete control row.',
              y: 'Percentage from the top edge of the camera.',
              spacing: 'Percentage between adjacent control buttons.',
            },
          )}
        </div>
        ${this._renderButtonEditor(
          'substream',
          'HD stream button',
          'Switches between the configured main and HD camera entities.',
          'HD active / return icon',
        )}
        ${this._renderButtonEditor(
          'recording',
          'Recording button',
          'Opens UniFi Protect recordings for the current camera and returns to live view when pressed again.',
          'Recording active / return-to-live icon',
        )}
        ${this._renderButtonEditor(
          'fullscreen',
          'Fullscreen button',
          'Uses a separate active icon while fullscreen is open; click it again to exit.',
          'Fullscreen exit icon',
        )}
      </section>
      ${this._renderPresetGroups()}
    </div>`;
  }

  static styles = css`
    :host {
      display: block;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .editor,
    section,
    .items,
    .item,
    .subsection,
    .preset-list {
      display: grid;
    }

    .editor {
      gap: var(--ha-space-6, 24px);
      container-type: inline-size;
    }

    section {
      gap: var(--ha-space-3, 12px);
    }

    h3,
    h4,
    p {
      margin: 0;
    }

    h3 {
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-medium, 500);
    }

    h4 {
      font-size: var(--ha-font-size-l, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
    }

    .helper,
    .item-heading span,
    .preset-heading span {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px);
      line-height: 1.4;
    }

    .items {
      gap: var(--ha-space-3, 12px);
    }

    .item,
    .subsection {
      min-width: 0;
      gap: var(--ha-space-3, 12px);
      padding: var(--ha-space-4, 16px);
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-border-radius-lg, 12px);
    }

    .subsection {
      margin-top: var(--ha-space-1, 4px);
    }

    .item-header,
    .preset-item {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--ha-space-2, 8px);
    }

    .item-heading {
      display: flex;
      min-width: 0;
      flex: 1;
      flex-direction: column;
    }

    .item-heading.no-handle {
      padding-inline-start: 32px;
    }

    .handle {
      display: flex;
      flex: 0 0 24px;
      align-items: center;
      color: var(--secondary-text-color);
      cursor: grab;
      touch-action: none;
    }

    .handle > * {
      pointer-events: none;
    }

    .item-actions {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
    }

    ha-icon-button {
      --ha-icon-button-size: 36px;
      color: var(--secondary-text-color);
    }

    ha-button {
      justify-self: start;
    }

    .preset-heading {
      display: flex;
      flex-direction: column;
      gap: var(--ha-space-1, 4px);
      padding-top: var(--ha-space-2, 8px);
      border-top: 1px solid var(--divider-color);
    }

    .preset-list {
      gap: var(--ha-space-2, 8px);
    }

    .preset-item {
      padding-block: var(--ha-space-1, 4px);
    }

    .preset-form {
      min-width: 0;
      flex: 1;
    }

    @container (max-width: 620px) {
      .preset-item {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .preset-form {
        flex-basis: calc(100% - 36px);
      }

      .preset-item .item-actions {
        margin-inline-start: 32px;
      }
    }
  `;
}
