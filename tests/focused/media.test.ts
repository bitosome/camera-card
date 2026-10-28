// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCameraStreamElements } from '@bitosome/ha-card-ui';
import { CameraCard } from '../../src/focused/card';
import type { HomeAssistant } from '../../src/focused/types';

vi.mock('@bitosome/ha-card-ui', async (original) => ({
  ...(await original<typeof import('@bitosome/ha-card-ui')>()),
  ensureCameraStreamElements: vi.fn(),
}));
const loader = vi.mocked(ensureCameraStreamElements);
const calls: { resolve: () => void; reject: (reason: Error) => void }[] = [];

beforeEach(() => {
  calls.length = 0;
  loader.mockReset();
  loader.mockImplementation(
    () => new Promise<void>((resolve, reject) => calls.push({ resolve, reject })),
  );
});
afterEach(() => {
  document.body.replaceChildren();
  for (const call of calls) call.resolve();
});

async function mount(transport: 'webrtc' | 'auto' = 'webrtc') {
  const card = new CameraCard();
  card.hass = {
    states: {
      'camera.fixture': {
        entity_id: 'camera.fixture',
        state: 'recording',
        attributes: { supported_features: 2 },
      },
    },
    callService: vi.fn(),
    callWS: vi.fn(),
  } as HomeAssistant;
  card.setConfig({
    cameras: [{ camera_entity: 'camera.fixture' }],
    focused: { live_transport: transport },
  });
  document.body.append(card);
  await card.updateComplete;
  return card;
}
async function settled(card: CameraCard) {
  await Promise.resolve();
  await Promise.resolve();
  await card.updateComplete;
}

describe('shared stream bootstrap', () => {
  it.each([
    ['webrtc', 'ha-web-rtc-player'],
    ['auto', 'ha-camera-stream'],
  ] as const)('waits for the %s transport element', async (transport, tag) => {
    const card = await mount(transport);
    expect(loader).toHaveBeenCalledWith('camera.fixture', tag);
    expect(card.shadowRoot?.querySelector(tag)).toBeNull();
    calls[0].resolve();
    await settled(card);
    expect(card.shadowRoot?.querySelector(tag)).not.toBeNull();
    expect(card.hass?.callService).not.toHaveBeenCalled();
  });

  it('offers retry on failure and does not loop on HA state updates', async () => {
    const card = await mount();
    calls[0].reject(new Error('Camera components could not be loaded.'));
    await settled(card);
    expect(card.shadowRoot?.textContent).toContain('could not be loaded');
    card.hass = { ...card.hass! };
    await card.updateComplete;
    expect(loader).toHaveBeenCalledTimes(1);
    const retry = [...card.shadowRoot!.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry camera'),
    );
    retry!.click();
    expect(loader).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await settled(card);
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).not.toBeNull();
    expect(card.shadowRoot?.textContent).not.toContain('could not be loaded');
  });

  it('ignores a previous transport response after configuration changes', async () => {
    const card = await mount();
    card.setConfig({
      cameras: [{ camera_entity: 'camera.fixture' }],
      focused: { live_transport: 'auto' },
    });
    expect(loader).toHaveBeenLastCalledWith('camera.fixture', 'ha-camera-stream');
    calls[0].resolve();
    await settled(card);
    expect(card.shadowRoot?.querySelector('ha-camera-stream')).toBeNull();
    calls[1].resolve();
    await settled(card);
    expect(card.shadowRoot?.querySelector('ha-camera-stream')).not.toBeNull();
  });

  it('retries interrupted loading on reconnect without restoring an obsolete error', async () => {
    const card = await mount();
    card.remove();
    document.body.append(card);
    await card.updateComplete;
    expect(loader).toHaveBeenCalledTimes(2);
    calls[0].reject(new Error('Obsolete request'));
    await settled(card);
    expect(card.shadowRoot?.textContent).not.toContain('Obsolete');
    calls[1].resolve();
    await settled(card);
    expect(card.shadowRoot?.querySelector('ha-web-rtc-player')).not.toBeNull();
  });
});
