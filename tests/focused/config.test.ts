import { describe, expect, it } from 'vitest';
import {
  createDefaultModel,
  normalizeFocusedConfig,
  serializeFocusedConfig,
} from '../../src/focused/config';

describe('focused configuration', () => {
  it('reads main and HD cameras as one pair', () => {
    const model = normalizeFocusedConfig({
      type: 'custom:camera-card',
      cameras: [
        {
          camera_entity: 'camera.main',
          title: 'Driveway',
          dependencies: { cameras: ['driveway_hd'] },
        },
        {
          camera_entity: 'camera.hd',
          id: 'driveway_hd',
          capabilities: { disable_except: ['substream'] },
        },
      ],
    });

    expect(model.cameras).toEqual([
      { title: 'Driveway', main: 'camera.main', hd: 'camera.hd' },
    ]);
  });

  it('serializes only the focused runtime configuration', () => {
    const model = createDefaultModel('camera.main');
    model.cameras[0].title = 'Front';
    model.cameras[0].hd = 'camera.hd';
    model.settings.preset_groups.push({
      camera: 'camera.main',
      device_id: 'device-1',
      x: 50,
      y: 88,
      spacing: 12,
      presets: [{ name: 'Home', icon: 'mdi:home' }],
    });

    const config = serializeFocusedConfig(model);

    expect(config).toEqual({
      type: 'custom:camera-card',
      cameras: [
        {
          camera_entity: 'camera.main',
          title: 'Front',
          live_provider: 'ha',
          dependencies: { cameras: ['focused_camera_1_hd'] },
        },
        {
          camera_entity: 'camera.hd',
          id: 'focused_camera_1_hd',
          title: 'Front HD',
          live_provider: 'ha',
          capabilities: { disable_except: ['substream'] },
        },
      ],
      focused: model.settings,
    });
  });

  it('keeps incomplete preset rows while they are edited', () => {
    const model = normalizeFocusedConfig({
      type: 'custom:camera-card',
      cameras: [{ camera_entity: 'camera.main' }],
      focused: {
        preset_groups: [
          {
            camera: 'camera.main',
            device_id: '',
            x: 50,
            y: 88,
            spacing: 12,
            presets: [{ name: 'Home', icon: 'mdi:home' }],
          },
        ],
      },
    });

    expect(model.settings.preset_groups).toHaveLength(1);
    expect(model.settings.preset_groups[0].device_id).toBe('');
  });

  it('preserves blank and partial percentage drafts', () => {
    const model = normalizeFocusedConfig({
      type: 'custom:camera-card',
      cameras: [{ camera_entity: 'camera.main' }],
      focused: {
        controls: {
          x: '',
          y: '89',
          spacing: '1',
        },
      },
    });

    expect(model.settings.controls).toEqual({ x: '', y: '89', spacing: '1' });
  });

  it('enables recording playback with customizable icons by default', () => {
    const model = createDefaultModel('camera.main');

    expect(model.settings.recording).toEqual({
      enabled: true,
      icon: 'mdi:history',
      active_icon: 'mdi:video',
    });
  });
});
