import { describe, expect, it, vi } from 'vitest';
import {
  callUniFiPreset,
  isFocusedCardFullscreen,
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
});
