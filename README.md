# Camera Card

A small Home Assistant dashboard card for live camera streams and UniFi Protect
PTZ presets.

## Features

- Main and HD Home Assistant camera streams.
- Reorderable camera navigation.
- Fullscreen with a dedicated active/exit icon.
- Customizable icons, button size, and percentage-based positions.
- Per-camera UniFi Protect PTZ preset rows.
- Reorderable presets with an explicit name and icon for every preset.
- Native Home Assistant forms and selectors throughout the visual editor.

## Requirements

- Home Assistant 2026.8 or newer.
- UniFi Protect integration for PTZ preset controls.

## Installation

1. Add this repository to HACS as a custom **Dashboard** repository.
2. Install **Camera Card**.
3. Refresh the browser when HACS asks.
4. Add a manual card with a main camera entity:

```yaml
type: custom:camera-card
cameras:
  - camera_entity: camera.example
```

Open the dashboard editor to configure the rest visually.

## Visual editor

### Camera streams

For every camera, choose:

- Camera name.
- Main stream entity.
- Optional HD stream entity.

Drag camera rows or use the arrow buttons to change navigation order.

### Overlay controls

The HD and fullscreen controls each provide:

- Show/hide toggle.
- Normal icon.
- Active/return icon.
- Horizontal position (`0`–`100`).
- Vertical position (`0`–`100`).

Positions are percentages of the camera surface. The fullscreen active icon
exits fullscreen when clicked.

### Preset controls

Each preset row selects:

- The camera on which the row appears.
- The UniFi Protect PTZ device that receives the action.
- Row center, vertical position, and spacing between icons.

Every preset has its own **Preset name** and **Preset icon**. The name must
exactly match the preset name in UniFi Protect. Presets can be reordered by
dragging or with the arrow buttons.

Preset buttons call:

```yaml
action: unifiprotect.ptz_goto_preset
data:
  device_id: <selected UniFi Protect device>
  preset: <configured preset name>
```

## Complete configuration example

```yaml
type: custom:camera-card
cameras:
  - camera_entity: camera.driveway_medium
    title: Driveway
    live_provider: ha
    dependencies:
      cameras:
        - focused_camera_1_hd
  - camera_entity: camera.driveway_high
    id: focused_camera_1_hd
    title: Driveway HD
    live_provider: ha
    capabilities:
      disable_except:
        - substream
focused:
  button_size: 34
  substream:
    enabled: true
    icon: mdi:high-definition
    active_icon: mdi:standard-definition
    x: 86
    y: 8
  fullscreen:
    enabled: true
    icon: mdi:fullscreen
    active_icon: mdi:fullscreen-exit
    x: 94
    y: 8
  preset_groups:
    - camera: camera.driveway_medium
      device_id: unifi-protect-device-id
      x: 50
      y: 88
      spacing: 12
      presets:
        - name: Home
          icon: mdi:home
        - name: Carport
          icon: mdi:car
```

## License

[MIT](LICENSE)
