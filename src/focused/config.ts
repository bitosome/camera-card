import type {
  FocusedCameraPair,
  FocusedModel,
  FocusedOverlayButton,
  FocusedPreset,
  FocusedPresetGroup,
  FocusedSettings,
  RawFocusedCamera,
  RawFocusedConfig,
} from './types.js';

const DEFAULT_SETTINGS: FocusedSettings = {
  button_size: 34,
  controls: {
    x: 90,
    y: 8,
    spacing: 8,
  },
  substream: {
    enabled: true,
    icon: 'mdi:high-definition',
    active_icon: 'mdi:standard-definition',
  },
  recording: {
    enabled: true,
    icon: 'mdi:history',
    active_icon: 'mdi:video',
  },
  fullscreen: {
    enabled: true,
    icon: 'mdi:fullscreen',
    active_icon: 'mdi:fullscreen-exit',
  },
  preset_groups: [],
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNumber = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value === 'string' && value.trim() === '') {
    return fallback;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
};

const asPosition = (value: unknown, fallback: number): number | string => {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const normalizeButton = (
  value: unknown,
  fallback: FocusedOverlayButton,
): FocusedOverlayButton => {
  const button = asRecord(value);
  return {
    enabled: typeof button?.enabled === 'boolean' ? button.enabled : fallback.enabled,
    icon: asString(button?.icon, fallback.icon),
    active_icon: asString(button?.active_icon, fallback.active_icon),
  };
};

const normalizePreset = (value: unknown): FocusedPreset | null => {
  const preset = asRecord(value);
  const name = asString(preset?.name);
  return name ? { name, icon: asString(preset?.icon, 'mdi:cctv') } : null;
};

const normalizePresetGroup = (value: unknown): FocusedPresetGroup | null => {
  const group = asRecord(value);
  const camera = asString(group?.camera);
  if (!camera) {
    return null;
  }
  return {
    camera,
    device_id: asString(group?.device_id),
    x: asPosition(group?.x, 50),
    y: asPosition(group?.y, 88),
    spacing: asPosition(group?.spacing, 12),
    presets: Array.isArray(group?.presets)
      ? group.presets
          .map(normalizePreset)
          .filter((preset): preset is FocusedPreset => preset !== null)
      : [],
  };
};

export const getCameraPairs = (config: RawFocusedConfig): FocusedCameraPair[] => {
  const cameras = Array.isArray(config.cameras) ? config.cameras : [];
  const byID = new Map<string, RawFocusedCamera>();
  for (const camera of cameras) {
    if (camera.id) {
      byID.set(camera.id, camera);
    }
  }

  const substreamIDs = new Set(
    cameras.flatMap((camera) => camera.dependencies?.cameras ?? []),
  );
  return cameras.flatMap((camera) => {
    if (
      !camera.camera_entity ||
      (camera.id && substreamIDs.has(camera.id)) ||
      camera.capabilities?.disable_except?.includes('substream')
    ) {
      return [];
    }
    const hdID = camera.dependencies?.cameras?.[0];
    return [
      {
        title: camera.title ?? camera.camera_entity,
        main: camera.camera_entity,
        hd: (hdID && byID.get(hdID)?.camera_entity) || '',
      },
    ];
  });
};

export const normalizeFocusedConfig = (config: RawFocusedConfig): FocusedModel => {
  const focused = asRecord(config.focused);
  return {
    cameras: getCameraPairs(config),
    settings: {
      button_size: asNumber(focused?.button_size, DEFAULT_SETTINGS.button_size, 24, 80),
      controls: {
        x: asPosition(asRecord(focused?.controls)?.x, 90),
        y: asPosition(asRecord(focused?.controls)?.y, 8),
        spacing: asPosition(asRecord(focused?.controls)?.spacing, 8),
      },
      substream: normalizeButton(focused?.substream, DEFAULT_SETTINGS.substream),
      recording: normalizeButton(focused?.recording, DEFAULT_SETTINGS.recording),
      fullscreen: normalizeButton(focused?.fullscreen, DEFAULT_SETTINGS.fullscreen),
      preset_groups: Array.isArray(focused?.preset_groups)
        ? focused.preset_groups
            .map(normalizePresetGroup)
            .filter((group): group is FocusedPresetGroup => group !== null)
        : [],
    },
  };
};

export const serializeFocusedConfig = (
  model: FocusedModel,
  type = 'custom:camera-card',
): RawFocusedConfig => {
  const cameras: RawFocusedCamera[] = [];
  model.cameras.forEach((pair, index) => {
    if (!pair.main) {
      return;
    }
    const hdID = `focused_camera_${index + 1}_hd`;
    cameras.push({
      camera_entity: pair.main,
      title: pair.title || pair.main,
      live_provider: 'ha',
      ...(pair.hd ? { dependencies: { cameras: [hdID] } } : {}),
    });
    if (pair.hd) {
      cameras.push({
        camera_entity: pair.hd,
        id: hdID,
        title: `${pair.title || pair.main} HD`,
        live_provider: 'ha',
        capabilities: { disable_except: ['substream'] },
      });
    }
  });
  return { type, cameras, focused: structuredClone(model.settings) };
};

export const createDefaultModel = (cameraEntity = ''): FocusedModel => ({
  cameras: [{ title: cameraEntity || 'Camera', main: cameraEntity, hd: '' }],
  settings: structuredClone(DEFAULT_SETTINGS),
});
