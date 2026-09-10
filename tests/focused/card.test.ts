import { describe, expect, it, vi } from 'vitest';
import {
  CameraCard,
  callUniFiPreset,
  createUniFiRecordingPath,
  groupedButtonLeft,
  isFocusedCardFullscreen,
  recordingClipWindow,
  resolvePercentage,
  toLocalDateTimeValue,
  toggleFocusedCardFullscreen,
  type FocusedFullscreenAPI,
} from '../../src/focused/card';
import type { HomeAssistant } from '../../src/focused/types';

// @vitest-environment jsdom
describe('focused card', () => {
  it('calls the UniFi Protect preset service directly', async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const hass = { callService } as unknown as HomeAssistant;

    await callUniFiPreset(hass, 'device-1', 'Carport');

    expect(callService).toHaveBeenCalledWith('unifiprotect', 'ptz_goto_preset', {
      device_id: 'device-1',
      preset: 'Carport',
    });
  });

  it('enters fullscreen, reports the active card, and exits on the next click', async () => {
    const card = document.createElement('div');
    const api: FocusedFullscreenAPI = {
      isEnabled: true,
      isFullscreen: false,
      element: undefined,
      request: vi.fn(async (element: Element) => {
        Object.assign(api, { isFullscreen: true, element });
      }),
      exit: vi.fn(async () => {
        Object.assign(api, { isFullscreen: false, element: undefined });
      }),
    };

    await toggleFocusedCardFullscreen(api, card);
    expect(api.request).toHaveBeenCalledWith(card);
    expect(isFocusedCardFullscreen(api, card)).toBe(true);

    await toggleFocusedCardFullscreen(api, card);
    expect(api.exit).toHaveBeenCalledOnce();
    expect(isFocusedCardFullscreen(api, card)).toBe(false);
  });

  it('falls back when native fullscreen is unavailable', async () => {
    const api: FocusedFullscreenAPI = {
      isEnabled: false,
      isFullscreen: false,
      request: vi.fn(),
      exit: vi.fn(),
    };

    await expect(
      toggleFocusedCardFullscreen(api, document.createElement('div')),
    ).resolves.toBe(false);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('uses safe runtime values without rewriting editable drafts', () => {
    expect(resolvePercentage('', 90)).toBe(90);
    expect(resolvePercentage('35', 90)).toBe(35);
    expect(resolvePercentage('120', 90)).toBe(100);
  });

  it('moves an entire button row inside the camera without changing its spacing', () => {
    expect(groupedButtonLeft(90, 10, 3, 0, 34)).toBe(
      'calc(clamp(calc(17px + 10%), 90%, calc(100% - 17px - 10%)) - 10%)',
    );
    expect(groupedButtonLeft(90, 10, 3, 1, 34)).toBe(
      'clamp(calc(17px + 10%), 90%, calc(100% - 17px - 10%))',
    );
    expect(groupedButtonLeft(90, 10, 3, 2, 34)).toBe(
      'calc(clamp(calc(17px + 10%), 90%, calc(100% - 17px - 10%)) + 10%)',
    );
  });

  it('builds a bounded UniFi Protect recording request', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const requested = Date.parse('2026-09-08T11:50:00.000Z');
    const { start, end } = recordingClipWindow(requested, now);

    expect(start.toISOString()).toBe('2026-09-08T11:50:00.000Z');
    expect(end.toISOString()).toBe('2026-09-08T11:50:10.000Z');
    expect(createUniFiRecordingPath('entry-1', 'camera.driveway', start, end)).toBe(
      '/api/unifiprotect/video/entry-1/camera.driveway/2026-09-08T11%3A50%3A00.000Z/2026-09-08T11%3A50%3A10.000Z',
    );
  });

  it('keeps recording clips in the past and formats local input values', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const { start, end } = recordingClipWindow(now + 60_000, now);

    expect(start.getTime()).toBe(now - 10_000);
    expect(end.getTime()).toBe(now);
    expect(toLocalDateTimeValue(start.getTime())).toMatch(/^2026-09-08T\d{2}:\d{2}$/);
  });

  it('uses and exits the viewport fallback when native fullscreen is unavailable', async () => {
    const card = new CameraCard();
    card.hass = {
      states: {
        'camera.main': {
          entity_id: 'camera.main',
          state: 'streaming',
          attributes: {},
        },
      },
      callService: vi.fn(),
    };
    card.setConfig({
      type: 'custom:camera-card',
      cameras: [{ camera_entity: 'camera.main' }],
    });
    document.body.append(card);
    await card.updateComplete;

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Enter fullscreen"]')
      ?.click();
    await Promise.resolve();
    await card.updateComplete;
    expect(card.hasAttribute('data-fullscreen-fallback')).toBe(true);
    expect(
      card.shadowRoot?.querySelector('[aria-label="Exit fullscreen"]'),
    ).not.toBeNull();

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen"]')
      ?.click();
    await card.updateComplete;
    expect(card.hasAttribute('data-fullscreen-fallback')).toBe(false);
    card.remove();
  });

  it('resolves and signs a recording URL through Home Assistant', async () => {
    const callWS = vi.fn(async (message: Record<string, unknown>) => {
      if (message.type === 'config/entity_registry/get') {
        return { platform: 'unifiprotect', config_entry_id: 'entry-1' };
      }
      return { path: '/signed-recording?authSig=test' };
    });
    const card = new CameraCard();
    card.hass = {
      states: {
        'camera.main': {
          entity_id: 'camera.main',
          state: 'streaming',
          attributes: {},
        },
      },
      callWS,
      callService: vi.fn(),
    } as unknown as HomeAssistant;
    card.setConfig({
      type: 'custom:camera-card',
      cameras: [{ camera_entity: 'camera.main' }],
    });
    document.body.append(card);
    await card.updateComplete;

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="View recordings"]')
      ?.click();

    await vi.waitFor(() => {
      expect(card.shadowRoot?.querySelector('video')?.getAttribute('src')).toBe(
        '/signed-recording?authSig=test',
      );
    });
    expect(card.shadowRoot?.querySelector('.recording-datetime')).toBeNull();
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Show recording timeline"]')
      ?.click();
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('.recording-datetime')).not.toBeNull();
    expect(callWS).toHaveBeenNthCalledWith(1, {
      type: 'config/entity_registry/get',
      entity_id: 'camera.main',
    });
    expect(callWS).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'auth/sign_path',
        path: expect.stringContaining('/api/unifiprotect/video/entry-1/camera.main/'),
        expires: 3600,
      }),
    );
    card.remove();
  });
});
