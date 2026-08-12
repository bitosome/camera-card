import { describe, expect, it, vi } from 'vitest';
import {
  CameraCard,
  callUniFiPreset,
  isFocusedCardFullscreen,
  resolvePercentage,
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
});
