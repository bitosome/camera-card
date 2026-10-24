// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraCard } from '../../src/focused/card';
import { CameraCardEditor } from '../../src/focused/editor';
import type { HomeAssistant, RawFocusedConfig } from '../../src/focused/types';

if (!customElements.get('ha-camera-stream')) {
  customElements.define('ha-camera-stream', class extends HTMLElement {});
}

afterEach(() => document.body.replaceChildren());

async function renderCamera(
  state = 'recording',
  attributes: Record<string, unknown> = { supported_features: 2 },
  transport: 'auto' | 'webrtc' = 'webrtc',
) {
  const card = new CameraCard();
  card.hass = {
    states: { 'camera.main': { entity_id: 'camera.main', state, attributes } },
    callWS: vi.fn(),
    callService: vi.fn(),
  } as HomeAssistant;
  card.setConfig({
    cameras: [{ camera_entity: 'camera.main', title: 'Driveway' }],
    focused: { live_transport: transport },
  });
  document.body.append(card);
  await card.updateComplete;
  return card;
}

describe('live transport', () => {
  it('keeps the native automatic player as the default path', async () => {
    const card = await renderCamera('recording', { supported_features: 2 }, 'auto');
    expect(card.shadowRoot?.querySelector('ha-camera-stream')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).toBeNull();
  });

  it('uses only WebRTC and does not start HLS', async () => {
    const card = await renderCamera();
    const player = card.shadowRoot?.querySelector('ha-web-rtc-player') as HTMLElement & {
      entityid: string;
      muted: boolean;
      controls: boolean;
    };
    expect(player.entityid).toBe('camera.main');
    expect(player.muted).toBe(true);
    expect(player.controls).toBe(false);
    expect(card.shadowRoot?.querySelector('ha-camera-stream')).toBeNull();
    expect(card.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    expect(card.hass?.callWS).not.toHaveBeenCalled();
    expect(card.hass?.callService).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'unknown'])(
    'attempts a supported stream but preserves the %s status',
    async (state) => {
      const card = await renderCamera(state);
      expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).not.toBeNull();
      expect(card.shadowRoot?.querySelector('[role="status"]')?.textContent).toContain(
        state,
      );
      expect(card.hass?.states['camera.main'].state).toBe(state);
    },
  );

  it.each([{ supported_features: 0 }, { supported_features: 2, restored: true }, {}])(
    'does not attempt offline/restored cameras without a live source: %j',
    async (attributes) => {
      const card = await renderCamera('unavailable', attributes);
      expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).toBeNull();
      expect(card.shadowRoot?.textContent).toContain('Driveway is unavailable');
    },
  );

  it('hides the warning only after video and restores it on failure or reconnect', async () => {
    const card = await renderCamera('unavailable');
    const player = card.shadowRoot!.querySelector('ha-web-rtc-player')!;
    const report = (hasVideo: boolean) =>
      player.dispatchEvent(new CustomEvent('streams', { detail: { hasVideo } }));
    report(false);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
    report(true);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    expect(card.hass?.states['camera.main'].state).toBe('unavailable');
    report(false);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
    report(true);
    await card.updateComplete;
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Reconnect live stream"]')
      ?.click();
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
    report(true);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
  });

  it('does not reuse video confirmation after a card is reattached', async () => {
    const card = await renderCamera('unavailable');
    card
      .shadowRoot!.querySelector('ha-web-rtc-player')!
      .dispatchEvent(new CustomEvent('streams', { detail: { hasVideo: true } }));
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    card.remove();
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
  });

  it('does not bypass unavailable state in Automatic mode', async () => {
    const card = await renderCamera('unavailable', { supported_features: 2 }, 'auto');
    expect(card.shadowRoot?.querySelector('ha-camera-stream')).toBeNull();
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).toBeNull();
  });

  it('shows missing entities and non-streaming entities honestly', async () => {
    const card = await renderCamera('idle', { supported_features: 0 });
    expect(card.shadowRoot?.textContent).toContain('does not advertise live streaming');
    card.hass = { ...card.hass!, states: {} };
    await card.updateComplete;
    expect(card.shadowRoot?.textContent).toContain('Camera entity not found');
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).toBeNull();
  });

  it('remounts on reconnect and HD selection, not on an availability update', async () => {
    const card = await renderCamera('unavailable');
    const original = card.shadowRoot?.querySelector('ha-web-rtc-player');
    card.hass = {
      ...card.hass!,
      states: {
        'camera.main': {
          entity_id: 'camera.main',
          state: 'recording',
          attributes: { supported_features: 2 },
        },
      },
    };
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).toBe(original);
    expect(card.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Reconnect live stream"]')
      ?.click();
    await card.updateComplete;
    const reconnected = card.shadowRoot?.querySelector('ha-web-rtc-player');
    expect(reconnected).not.toBe(original);
    card.hass = {
      ...card.hass!,
      states: {
        ...card.hass!.states,
        'camera.hd': {
          entity_id: 'camera.hd',
          state: 'recording',
          attributes: { supported_features: 2 },
        },
      },
    };
    card.setConfig({
      cameras: [
        { camera_entity: 'camera.main', dependencies: { cameras: ['hd'] } },
        { camera_entity: 'camera.hd', id: 'hd' },
      ],
      focused: { live_transport: 'webrtc' },
    });
    await card.updateComplete;
    card.shadowRoot
      ?.querySelector<HTMLButtonElement>('[aria-label="Use HD stream"]')
      ?.click();
    await card.updateComplete;
    const hd = card.shadowRoot?.querySelector('ha-web-rtc-player') as HTMLElement & {
      entityid: string;
    };
    expect(hd).not.toBe(reconnected);
    expect(hd.entityid).toBe('camera.hd');
  });

  it('exposes the transport option in the visual editor and preserves it on edits', async () => {
    const editor = new CameraCardEditor();
    editor.hass = { states: {}, callWS: vi.fn(), callService: vi.fn() } as HomeAssistant;
    editor.setConfig({ cameras: [{ camera_entity: 'camera.main' }] });
    document.body.append(editor);
    await editor.updateComplete;
    const form = [...editor.shadowRoot!.querySelectorAll('ha-form')].find(
      (f) =>
        'live_transport' in (f as HTMLElement & { data: Record<string, unknown> }).data,
    )!;
    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { live_transport: 'webrtc' } },
      }),
    );
    await editor.updateComplete;
    const event = changed.mock.calls[0][0] as CustomEvent<{ config: RawFocusedConfig }>;
    expect(event.detail.config.focused?.live_transport).toBe('webrtc');
  });
});
