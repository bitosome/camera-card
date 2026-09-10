import { describe, expect, it, vi } from 'vitest';
import {
  CameraCard,
  callUniFiPreset,
  createUniFiRecordingPath,
  formatHassDateTime,
  groupedButtonLeft,
  isFocusedCardFullscreen,
  parseHassDateTimeValue,
  recordingClipWindow,
  recordingSeekWindow,
  resolvePercentage,
  toHassDateTimeValue,
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

  it('keeps clips in the past and honors Home Assistant date/time settings', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const { start, end } = recordingClipWindow(now + 60_000, now);
    const hass = {
      locale: {
        language: 'en-GB',
        time_format: '24',
        date_format: 'DMY',
        time_zone: 'server',
      },
      config: { time_zone: 'Europe/Tallinn' },
    } as HomeAssistant;
    const timestamp = Date.parse('2026-09-08T12:34:00.000Z');

    expect(start.getTime()).toBe(now - 10_000);
    expect(end.getTime()).toBe(now);
    expect(toHassDateTimeValue(timestamp, hass)).toBe('2026-09-08T15:34');
    expect(parseHassDateTimeValue('2026-09-08T15:34', hass)).toBe(timestamp);
    expect(formatHassDateTime(timestamp, hass)).toBe('08/09/2026, 15:34:00');

    const twelveHourHass = {
      locale: {
        language: 'en-US',
        time_format: '12',
        date_format: 'MDY',
        time_zone: 'server',
      },
      config: { time_zone: 'UTC' },
    } as HomeAssistant;
    expect(formatHassDateTime(timestamp, twelveHourHass)).toBe('9/8/2026, 12:34:00 PM');
  });

  it('centers a 30-minute seek window unless it would extend into live video', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const oldPosition = Date.parse('2026-09-08T11:00:00.000Z');

    expect(recordingSeekWindow(oldPosition, now)).toEqual({
      start: Date.parse('2026-09-08T10:45:00.000Z'),
      end: Date.parse('2026-09-08T11:15:00.000Z'),
    });
    expect(recordingSeekWindow(now - 5 * 60_000, now)).toEqual({
      start: now - 30 * 60_000 - 10_000,
      end: now - 10_000,
    });
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
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
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

    await vi.waitFor(() =>
      expect(card.shadowRoot?.querySelector('video')?.getAttribute('src')).toBe(
        '/signed-recording?authSig=test',
      ),
    );
    expect(card.shadowRoot?.querySelector('video')?.controls).toBe(false);
    expect(card.shadowRoot?.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(
      card.shadowRoot?.querySelector('[aria-label="Recording playback time"]'),
    ).not.toBeNull();
    expect(
      card.shadowRoot?.querySelector('[aria-label="Pause recording"]'),
    ).not.toBeNull();
    expect(
      card.shadowRoot?.querySelector('[aria-label="Unmute recording"]'),
    ).not.toBeNull();

    const timeline = card.shadowRoot?.querySelector<HTMLInputElement>(
      '[aria-label="Recording playback time"]',
    );
    const selectedSecond = Number(timeline?.min) + 30;
    if (timeline) {
      timeline.value = String(selectedSecond);
      timeline.dispatchEvent(new Event('change'));
    }
    await vi.waitFor(() => expect(callWS).toHaveBeenCalledTimes(3));
    await card.updateComplete;
    expect(callWS).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: expect.stringContaining(
          encodeURIComponent(new Date(selectedSecond * 1000).toISOString()),
        ),
      }),
    );

    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Pause recording"]')
      ?.click();
    await card.updateComplete;
    expect(pause).toHaveBeenCalledOnce();
    expect(
      card.shadowRoot?.querySelector('[aria-label="Play recording"]'),
    ).not.toBeNull();

    const dateInput = card.shadowRoot?.querySelector('.recording-datetime');
    expect(dateInput).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.recording-pull-tab')).toBeNull();
    expect(dateInput?.closest('.recording-date-action')?.nextElementSibling).toBe(
      card.shadowRoot?.querySelector('.live-action'),
    );
    expect(card.shadowRoot?.querySelectorAll('input[type="range"]')).toHaveLength(1);
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
    pause.mockRestore();
  });
});
